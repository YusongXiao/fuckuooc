const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./config');

const DISCUSSION_TYPES = [10, 20, 30];
const DISCUSSION_KEYWORDS = ['讨论', '提问', '发言', '交流', '问答', '论坛', '话题'];
const PROBE_TEXT_RE = /(sandbox-auto-reply|interval-probe|cooldown-|window-|cross-area-probe|ui-cross-probe|controlled-)/i;

let discussionQueue = Promise.resolve();
let nextCommentAt = 0;

function discussionStateFile(courseId) {
    return path.join(DATA_DIR, `discussion_${courseId}.json`);
}

function loadDiscussionState(courseId) {
    const filePath = discussionStateFile(courseId);
    if (!fs.existsSync(filePath)) {
        return { postedThreadIds: [], usedContents: [], posts: [] };
    }
    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        return {
            postedThreadIds: Array.isArray(parsed.postedThreadIds) ? parsed.postedThreadIds : [],
            usedContents: Array.isArray(parsed.usedContents) ? parsed.usedContents : [],
            posts: Array.isArray(parsed.posts) ? parsed.posts : []
        };
    } catch {
        return { postedThreadIds: [], usedContents: [], posts: [] };
    }
}

function saveDiscussionState(courseId, state) {
    fs.writeFileSync(discussionStateFile(courseId), JSON.stringify(state, null, 2), 'utf-8');
}

function normalizeText(value) {
    return String(value || '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/\s+/g, ' ')
        .trim();
}

async function fetchJson(page, url, method = 'GET', body = null) {
    return page.evaluate(async ({ targetUrl, httpMethod, payload }) => {
        const options = {
            method: httpMethod,
            credentials: 'include',
            headers: {}
        };

        if (payload) {
            options.headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
            options.body = new URLSearchParams(payload).toString();
        }

        const response = await fetch(targetUrl, options);
        const text = await response.text();
        try {
            return JSON.parse(text);
        } catch {
            return { code: -1, msg: text };
        }
    }, {
        targetUrl: url,
        httpMethod: method,
        payload: body
    });
}

async function fetchDiscussionList(page, courseId, type, pageNo = 1, pageSize = 12) {
    const url = `http://www.uooc.net.cn/Home/Threads/list?cid=${courseId}&onlyteacher=0&page=${pageNo}&pagesize=${pageSize}&type=${type}`;
    const json = await fetchJson(page, url);
    return Array.isArray(json?.data?.data) ? json.data.data : [];
}

async function fetchDiscussionDetail(page, courseId, tid) {
    const url = `http://www.uooc.net.cn/Home/Threads/details?ask_page=1&ask_pagesize=10&cid=${courseId}&page=1&pagesize=20&tid=${tid}`;
    const json = await fetchJson(page, url);
    return json?.data || null;
}

function pickCopiedContent(detail, state) {
    if (!detail) return '';
    const myUid = detail.threads?.my_uid;
    const used = new Set(state.usedContents || []);
    const candidates = [];

    for (const post of detail.posts?.data || []) {
        const text = normalizeText(post.content);
        if (!text) continue;
        if (post.create_uid === myUid) continue;
        if (used.has(text)) continue;
        if (PROBE_TEXT_RE.test(text)) continue;
        candidates.push(text);
    }

    if (candidates.length > 0) {
        candidates.sort((left, right) => right.length - left.length);
        return candidates[0];
    }

    const fallback = normalizeText(detail.threads?.content || '');
    if (fallback && !used.has(fallback) && !PROBE_TEXT_RE.test(fallback)) {
        return fallback;
    }
    return '';
}

async function postReply(page, courseId, tid, content) {
    return fetchJson(page, 'http://www.uooc.net.cn/Home/Threads/reply', 'POST', {
        cid: String(courseId),
        tid: String(tid),
        content
    });
}

async function runWithCommentCooldown(task, intervalMs, log) {
    const runner = async () => {
        const waitMs = nextCommentAt - Date.now();
        if (waitMs > 0) {
            log(`💬 评论冷却中，等待 ${Math.ceil(waitMs / 1000)} 秒`);
            await new Promise(resolve => setTimeout(resolve, waitMs));
        }

        const result = await task();
        if (result?.code === 1 || result?.code === 600) {
            nextCommentAt = Date.now() + intervalMs;
        }
        return result;
    };

    const chained = discussionQueue.then(runner, runner);
    discussionQueue = chained.catch(() => {});
    return chained;
}

function parseTidFromUrl(url) {
    const match = String(url || '').match(/\/discussdetail\/\w+\/(\d+)/);
    return match ? match[1] : '';
}

async function getCurrentDiscussionContext(page) {
    return page.evaluate(() => {
        const href = location.href;
        const bodyText = document.body.innerText || '';
        const activeText = (document.querySelector('.oneline.active, .basic.active')?.innerText || '').replace(/\s+/g, ' ').trim();
        const threadLink = document.querySelector('a[href*="#/discussdetail/"]');
        const threadHref = threadLink ? threadLink.getAttribute('href') || '' : '';
        return { href, bodyText, activeText, threadHref };
    });
}

function guessDiscussionType(context) {
    const text = `${context.activeText || ''} ${context.bodyText || ''}`;
    if (text.includes('学生提问') || text.includes('提问')) return 10;
    if (text.includes('随堂讨论') || text.includes('专题讨论')) return 20;
    return 30;
}

function hasDiscussionKeyword(text) {
    return DISCUSSION_KEYWORDS.some(keyword => String(text || '').includes(keyword));
}

async function submitCopiedReply(page, courseId, tid, state, log, options = {}) {
    const detail = await fetchDiscussionDetail(page, courseId, tid);
    const copiedContent = pickCopiedContent(detail, state);
    if (!copiedContent) {
        log(`⚠️ 讨论贴 ${tid} 没找到可复制评论`);
        return false;
    }

    let result = await runWithCommentCooldown(
        () => postReply(page, courseId, tid, copiedContent),
        options.discussionIntervalMs || 65000,
        log
    );

    if (result?.code === 600) {
        log(`⚠️ 讨论贴 ${tid} 触发限流，按间隔重试一次`);
        result = await runWithCommentCooldown(
            () => postReply(page, courseId, tid, copiedContent),
            options.discussionIntervalMs || 65000,
            log
        );
    }

    if (result?.code !== 1) {
        log(`⚠️ 讨论贴 ${tid} 评论失败: ${result?.msg || 'unknown error'}`);
        return false;
    }

    state.postedThreadIds.push(Number(tid));
    state.usedContents.push(copiedContent);
    state.posts.push({
        tid: Number(tid),
        pid: result.data?.data?.pid || 0,
        content: copiedContent,
        createdAt: new Date().toISOString()
    });
    saveDiscussionState(courseId, state);
    log(`💬 讨论贴 ${tid} 评论成功`);
    return true;
}

async function runCourseDiscussionAutomation(page, courseId, log, options = {}) {
    const state = loadDiscussionState(courseId);
    const scanPages = Math.max(1, options.discussionScanPages || 1);
    const maxPosts = Number.isFinite(options.discussionMaxPosts) ? options.discussionMaxPosts : 0;
    const targets = [];

    try {
        await page.goto(`http://www.uooc.net.cn/home/course/${courseId}#/discusscom`, {
            waitUntil: 'domcontentloaded',
            timeout: 60000
        });
        await page.waitForTimeout(2000);
    } catch (err) {
        log(`⚠️ 打开课程讨论页失败: ${err.message}`);
    }

    for (const type of DISCUSSION_TYPES) {
        for (let pageNo = 1; pageNo <= scanPages; pageNo++) {
            let threads = [];
            try {
                threads = await fetchDiscussionList(page, courseId, type, pageNo);
            } catch (err) {
                log(`⚠️ 拉取讨论列表失败(type=${type}, page=${pageNo}): ${err.message}`);
                break;
            }
            if (!threads.length) break;

            for (const thread of threads) {
                if (state.postedThreadIds.includes(thread.tid)) continue;
                targets.push(thread);
            }
        }
    }

    if (targets.length === 0) {
        log('💬 主动评论：没有找到新的讨论区目标');
        return 0;
    }

    let successCount = 0;
    for (const thread of targets) {
        if (maxPosts > 0 && successCount >= maxPosts) break;
        const ok = await submitCopiedReply(page, courseId, thread.tid, state, log, options);
        if (ok) successCount++;
    }

    log(`💬 主动评论结束，本次成功 ${successCount} 条`);
    return successCount;
}

async function clickDiscussionTaskIfAvailable(page) {
    return page.evaluate(keywords => {
        for (const block of document.querySelectorAll('.basic')) {
            if (block.classList.contains('complete') || block.dataset.discussionHandled === '1') continue;
            const tag = block.querySelector('.tag-source-name')?.innerText || '';
            const title = block.innerText || '';
            const text = `${tag} ${title}`.replace(/\s+/g, ' ');
            if (!keywords.some(keyword => text.includes(keyword))) continue;
            try {
                block.scrollIntoView({ block: 'center' });
            } catch {}
            block.click();
            block.dataset.discussionHandled = '1';
            return true;
        }
        return false;
    }, DISCUSSION_KEYWORDS);
}

async function handleLearningDiscussionTask(page, courseId, log, options = {}) {
    const state = loadDiscussionState(courseId);
    const context = await getCurrentDiscussionContext(page);
    let tid = parseTidFromUrl(context.href);

    if (!tid && context.threadHref) {
        tid = parseTidFromUrl(context.threadHref);
    }

    if (!tid) {
        const type = guessDiscussionType(context);
        const list = await fetchDiscussionList(page, courseId, type, 1, 10);
        const target = list.find(thread => !state.postedThreadIds.includes(thread.tid));
        tid = target ? String(target.tid) : '';
    }

    if (!tid) {
        log('⚠️ 学习流讨论任务：未定位到讨论贴');
        return false;
    }

    const ok = await submitCopiedReply(page, courseId, tid, state, log, options);
    if (!ok) return false;
    await page.waitForTimeout(1000);
    return true;
}

async function isDiscussionTask(page) {
    return page.evaluate(keywords => {
        if (document.querySelector('video')) return false;
        const activeText = (document.querySelector('.oneline.active, .basic.active')?.innerText || '').replace(/\s+/g, ' ');
        if (keywords.some(keyword => activeText.includes(keyword))) return true;

        const bodyText = document.body.innerText || '';
        if (bodyText.includes('讨论区') && bodyText.includes('回复')) return true;
        if (document.querySelector('textarea') &&
            Array.from(document.querySelectorAll('button, a')).some(element => {
                const text = (element.innerText || '').trim();
                return text.includes('回复') || text.includes('发送');
            })) {
            return true;
        }
        if (document.querySelector('a[href*="#/discussdetail/"]')) return true;
        return false;
    }, DISCUSSION_KEYWORDS);
}

module.exports = {
    runCourseDiscussionAutomation,
    clickDiscussionTaskIfAvailable,
    handleLearningDiscussionTask,
    isDiscussionTask,
    hasDiscussionKeyword
};
