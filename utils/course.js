const { VideoTracker } = require('./video');
const { processQuizQuestions, clickQuizTaskIfAvailable } = require('./quiz');

async function initSectionList(page) {
    await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('.oneline')).filter(el => el.offsetParent !== null);
        window.__uoocSectionList = items;
        let idx = items.findIndex(el => el.classList.contains('active') || el.closest('.active'));
        if (idx < 0) idx = 0;
        window.__uoocSectionIndex = idx;
        console.log('📑 章节列表初始化，共', items.length, '节，当前 index =', idx);
    });
}

async function goToNextSection(page) {
    return page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('.oneline')).filter(el => el.offsetParent !== null);
        const idx = items.findIndex(el =>
            el.classList.contains('active') ||
            el.closest('.active') ||
            (el.closest('li')?.classList.contains('active'))
        );
        if (idx === -1 || idx >= items.length - 1) return false;
        const next = items[idx + 1];
        try { next.scrollIntoView({ block: 'center' }); } catch {}
        next.click();
        console.log('👉 下一节：', next.innerText.trim());
        return true;
    });
}

// 往后查找最近的未完成章节/节点，跳过当前卡住的位置
async function goToNextUncompleted(page) {
    return page.evaluate(() => {
        const chapters = Array.from(document.querySelectorAll('.catalogItem'));
        // 找到当前所在的章节
        let curIdx = chapters.findIndex(ch => {
            const header = ch.querySelector('.basic.chapter');
            return header && header.classList.contains('active');
        });
        if (curIdx === -1) {
            curIdx = chapters.findIndex(ch => ch.querySelector('.oneline.active, .basic.active'));
        }

        // 1) 先在当前章节内找未完成的 section/point（非当前 active 的）
        if (curIdx >= 0) {
            const curChapter = chapters[curIdx];
            // 找当前 active 的 section/point 的 <li>
            const activeEl = curChapter.querySelector('.oneline.active');
            const activeLi = activeEl ? activeEl.closest('li') : null;
            // 在当前章节内所有 .basic.uncomplete 中找一个不是当前 active 的
            const uncompleted = curChapter.querySelectorAll('.basic.uncomplete');
            for (const uc of uncompleted) {
                // 跳过章节级别的 header 本身
                if (uc.classList.contains('chapter')) continue;
                // 跳过当前 active 的元素
                if (uc.classList.contains('active')) continue;
                const li = uc.closest('li');
                if (li && li === activeLi) continue;
                const label = uc.querySelector('.oneline') || uc;
                try { label.scrollIntoView({ block: 'center' }); } catch {}
                label.click();
                console.log('⏩ 跳到当前章节内未完成节点：', label.innerText.trim());
                return true;
            }
        }

        // 2) 从当前章节往后找第一个 uncomplete 的章节
        for (let i = curIdx + 1; i < chapters.length; i++) {
            const header = chapters[i].querySelector('.basic.chapter');
            if (header && header.classList.contains('uncomplete')) {
                const label = chapters[i].querySelector('.oneline');
                if (label) {
                    try { label.scrollIntoView({ block: 'center' }); } catch {}
                    label.click();
                    console.log('⏩ 前进到未完成章节：', label.innerText.trim());
                    return true;
                }
            }
        }
        // 3) 往后没找到，从头开始找（可能前面有漏掉的）
        for (let i = 0; i < curIdx; i++) {
            const header = chapters[i].querySelector('.basic.chapter');
            if (header && header.classList.contains('uncomplete')) {
                const label = chapters[i].querySelector('.oneline');
                if (label) {
                    try { label.scrollIntoView({ block: 'center' }); } catch {}
                    label.click();
                    console.log('🔄 回到未完成章节：', label.innerText.trim());
                    return true;
                }
            }
        }
        return false;
    });
}

// 往前查找最近的未完成章节（章级别 .catalogItem），点击展开
async function goToPrevUncompleted(page) {
    return page.evaluate(() => {
        const chapters = Array.from(document.querySelectorAll('.catalogItem'));
        // 找到当前所在的章节
        let curIdx = chapters.findIndex(ch => {
            const header = ch.querySelector('.basic.chapter');
            return header && header.classList.contains('active');
        });
        if (curIdx === -1) {
            // 可能当前 active 在子节点上，通过 stateParams 匹配
            curIdx = chapters.findIndex(ch => ch.querySelector('.oneline.active, .basic.active'));
        }
        // 从当前章节往前找第一个 uncomplete 的章节
        for (let i = curIdx - 1; i >= 0; i--) {
            const header = chapters[i].querySelector('.basic.chapter');
            if (header && header.classList.contains('uncomplete')) {
                const label = chapters[i].querySelector('.oneline');
                if (label) {
                    try { label.scrollIntoView({ block: 'center' }); } catch {}
                    label.click();
                    console.log('🔙 回退到未完成章节：', label.innerText.trim());
                    return true;
                }
            }
        }
        return false;
    });
}

// 单个课程的完整学习流程（在独立 page 上运行）
async function learnCourse(page, courseId, log) {
    const tracker = new VideoTracker(courseId, log);

    log('🎓 开始自动学习...');
    await initSectionList(page);

    let quizRetries = 0;
    const MAX_QUIZ_RETRIES = 3;
    let gatelockRetries = 0;
    const MAX_GATELOCK_RETRIES = 10;

    while (true) {
        await page.waitForTimeout(3000);

        // 检测"测验通过"弹窗，点确定后直接跳到下一节
        const quizPassed = await page.evaluate(() => {
            const dialogs = document.querySelectorAll('.layui-layer-content');
            for (const d of dialogs) {
                if (d.innerText.includes('测验通过')) return true;
            }
            return false;
        });
        if (quizPassed) {
            log('✅ 检测到测验已通过');
            // 点击确定按钮关闭弹窗
            try {
                const okBtn = page.locator('.layui-layer-btn0');
                if (await okBtn.count() > 0) await okBtn.first().click();
            } catch {}
            await page.waitForTimeout(1000);
            quizRetries = 0;
            if (!await goToNextSection(page)) {
                if (await goToNextUncompleted(page)) {
                    log('⏩ 跳转到其他未完成章节...');
                    continue;
                }
                log('🏁 已完成所有章节');
                break;
            }
            continue;
        }

        const isQuiz = await page.evaluate(() => {
            if (document.querySelector('video')) return false;
            const active = document.querySelector('.oneline.active') || document.querySelector('.oneline.ng-binding.active');
            if (active) {
                const t = active.innerText.trim();
                if (t.includes('测验') || t.includes('测试')) return true;
            }
            const text = document.body.innerText;
            return text.includes('提交') || text.includes('开始测验') || text.includes('重新测验');
        });

        if (isQuiz) {
            if (quizRetries >= MAX_QUIZ_RETRIES) {
                log('⚠️ 测验重试次数已达上限，跳过本节');
                quizRetries = 0;
                if (!await goToNextSection(page)) {
                    if (await goToNextUncompleted(page)) {
                        log('⏩ 跳转到其他未完成章节...');
                        continue;
                    }
                    log('🏁 已完成所有章节');
                    break;
                }
                continue;
            }
            quizRetries++;
            await page.evaluate(() => {
                for (const block of document.querySelectorAll('.basic')) {
                    const tag = block.querySelector('.tag-source-name');
                    if (!tag) continue;
                    const t = tag.innerText.trim();
                    if (t.includes('测验') || t.includes('测试')) {
                        try { block.scrollIntoView({ block: 'center' }); } catch {}
                        block.click();
                        return;
                    }
                }
            });
            await processQuizQuestions(page, log, courseId);
            log('⏭️ 测验处理完毕');
        }

        if (await tracker.findUnwatchedVideo(page)) {
            quizRetries = 0;
            gatelockRetries = 0;
            log('📺 播放未看视频...');
            await tracker.playVideo(page);
            await tracker.markCurrentWatched(page);
            await page.waitForTimeout(3000);
        } else {
            // 检测闯关模式锁定或空子文件夹，自动跳过
            const skipReason = await page.evaluate(() => {
                // 闯关模式：页面上任意 .unfoldInfo 包含关键词即触发（ng-if 保证只有当前 section 的会渲染）
                for (const hint of document.querySelectorAll('.unfoldInfo')) {
                    const text = hint.innerText || '';
                    if (text.includes('闯关模式') || text.includes('请先完成之前')) return 'gatelock';
                }
                // 空子节点：只检查最深层 active 节点自身所在 <li>，避免误匹配父级 section 的提示
                const allActive = document.querySelectorAll('.oneline.active');
                const activeOneline = allActive.length ? allActive[allActive.length - 1] : null;
                if (activeOneline) {
                    const activeLi = activeOneline.closest('li');
                    if (activeLi) {
                        const hint = activeLi.querySelector(':scope > .unfoldInfo');
                        if (hint && (hint.innerText || '').includes('点击下方继续学习')) return 'empty';
                    }
                }
                return null;
            });
            if (skipReason === 'empty') {
                log('⏭️ 空子节点，跳过...');
                quizRetries = 0;
                if (!await goToNextSection(page)) {
                    if (await goToNextUncompleted(page)) {
                        log('⏩ 跳转到其他未完成章节...');
                        continue;
                    }
                    log('🏁 已完成所有章节');
                    break;
                }
                continue;
            }
            if (skipReason === 'gatelock') {
                gatelockRetries++;
                if (gatelockRetries > MAX_GATELOCK_RETRIES) {
                    log('⚠️ 闯关模式回退次数已达上限，跳过本节');
                    gatelockRetries = 0;
                    if (!await goToNextSection(page)) {
                        if (await goToNextUncompleted(page)) {
                            log('⏩ 跳转到其他未完成章节...');
                            continue;
                        }
                        log('🏁 已完成所有章节');
                        break;
                    }
                    continue;
                }
                log(`🔒 闯关模式锁定，往前查找未完成节点 (${gatelockRetries}/${MAX_GATELOCK_RETRIES})...`);
                quizRetries = 0;
                if (!await goToPrevUncompleted(page)) {
                    log('⚠️ 未找到前置未完成节点，跳过');
                    gatelockRetries = 0;
                    if (!await goToNextSection(page)) {
                        if (await goToNextUncompleted(page)) {
                            log('⏩ 跳转到其他未完成章节...');
                            continue;
                        }
                        log('🏁 已完成所有章节');
                        break;
                    }
                }
                continue;
            }

            if (await clickQuizTaskIfAvailable(page)) {
                log('📝 处理测验任务...');
                await processQuizQuestions(page, log, courseId);
                continue;
            }

            quizRetries = 0;
            log('⏭️ 进入下一节...');
            if (!await goToNextSection(page)) {
                // goToNextSection 失败，尝试跳到其他未完成章节
                if (await goToNextUncompleted(page)) {
                    log('⏩ 跳转到其他未完成章节...');
                    continue;
                }
                log('🏁 已完成所有章节');
                break;
            }
        }
    }
}

module.exports = { learnCourse };
