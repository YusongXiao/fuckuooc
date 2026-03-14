const path = require('path');
const { DATA_DIR, RETRY_MODEL } = require('./config');
const { locateInAnyFrame, humanClick, handleCaptcha } = require('./browser');
const { getAnswersFromImage } = require('./module');

async function clickQuizTaskIfAvailable(page) {
    return page.evaluate(() => {
        for (const block of document.querySelectorAll('.basic')) {
            if (block.classList.contains('complete') || block.dataset.quizHandled === '1') continue;
            const tag = block.querySelector('.tag-source-name');
            if (!tag) continue;
            const label = tag.innerText.trim().replace(/\s+/g, '');
            if (!label.includes('测验') && !label.includes('测试') && !label.toLowerCase().includes('quiz')) continue;
            try { block.scrollIntoView({ block: 'center' }); } catch {}
            block.click();
            block.dataset.quizHandled = '1';
            return true;
        }
        return false;
    });
}

async function processQuizQuestions(page, log, courseId) {
    const screenshotPath = path.join(DATA_DIR, `image_${courseId}.png`);

    log('🧩 开始处理测验...');
    await page.waitForTimeout(5000);

    const locate = (sel) => locateInAnyFrame(page, sel);

    const submitPaperBtn = await locate('button:has-text("提交试卷")');
    if (!submitPaperBtn) {
        log('⚠️ 未找到 [提交试卷]，跳过');
        return;
    }
    log('✅ 发现 [提交试卷]，开始做题...');

    let quizPassed = false;

    const MAX_ATTEMPTS = 2;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const isRetry = attempt > 0;
        let modelOptions = isRetry
            ? { model: RETRY_MODEL, reasoningEffort: 'high' }
            : { reasoningEffort: 'medium' };

        if (isRetry) {
            log(`🔄 重做测验（第 ${attempt + 1} 次尝试，使用 ${RETRY_MODEL}）...`);
            await clearAllSelections(page, log);
            await page.waitForTimeout(2000);
        }

        let questions = await findQuestions(page, log);
        if (questions.length === 0) {
            await page.waitForTimeout(5000);
            questions = await findQuestions(page, log);
        }
        if (questions.length === 0) {
            log('⚠️ 未找到题目');
            await page.screenshot({ path: `debug_quiz_fail_${courseId}.png` });
            break;
        }

        log(`   共 ${questions.length} 道题目`);

        // 首次答题前：检测是否已有选项被选中（测验做过但未提交/通过）
        if (!isRetry) {
            let hasExistingSelections = false;
            for (const q of questions) {
                const selected = await q.evaluate(el =>
                    el.querySelector('input[type="radio"]:checked, input[type="checkbox"]:checked') !== null
                );
                if (selected) { hasExistingSelections = true; break; }
            }
            if (hasExistingSelections) {
                log(`⚠️ 检测到已有选中项（测验做过但未提交/通过），先清空所有选项，使用 ${RETRY_MODEL} 重做...`);
                await clearAllSelections(page, log);
                await page.waitForTimeout(1000);
                modelOptions = { model: RETRY_MODEL, reasoningEffort: 'high' };
            }
        }

        // 答题
        for (let i = 0; i < questions.length; i++) {
            const q = questions[i];
            log(`   📸 第 ${i + 1}/${questions.length} 题`);

            try {
                await Promise.race([
                    answerOneQuestion(q, page, log, screenshotPath, modelOptions),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('单题超时')), 180000))
                ]);
            } catch (e) {
                log(`      ❌ 失败: ${e.message}`);
            }

            await page.waitForTimeout(2000);
        }

        // 提交试卷
        log('📝 提交试卷...');
        try {
            const btn = await locate('button:has-text("提交试卷")');
            if (btn) await btn.click();
        } catch {
            const btn = await locate('button:has-text("提交试卷")');
            if (btn) await btn.click();
        }
        await page.waitForTimeout(3000);

        await handleCaptcha(page, locate, async () => {
            const btn = await locate('div.btn.btn-warning:has-text("提交")');
            if (!btn) return false;
            return !(await btn.evaluate(el => el.classList.contains('disabled') || el.disabled));
        }, 10, log);

        const finalBtn = await locate('div.btn.btn-warning:has-text("提交")');
        if (finalBtn) {
            try {
                await humanClick(page, finalBtn);
                log('✅ 已提交');
            } catch (e) {
                log(`❌ 提交失败: ${e.message}`);
                break;
            }
        }

        // 检查分数
        await page.waitForTimeout(3000);
        const failMsg = await checkFailDialog(page, log);

        if (failMsg) {
            log(`⚠️ 测验未通过: ${failMsg}`);
            if (attempt < MAX_ATTEMPTS - 1) {
                await page.waitForTimeout(4000);
                continue;
            } else {
                log('⚠️ 重试次数已达上限');
            }
        } else {
            log('✅ 测验提交成功');
            quizPassed = true;
            break;
        }
    }

    // 兜底策略：暴力遍历未得分题目
    if (!quizPassed) {
        await bruteForceWrongQuestions(page, log, locate);
    }

    await page.waitForTimeout(3000);
}

// 答一道题：截图 → 大模型识别答案
async function answerOneQuestion(q, page, log, screenshotPath, modelOptions = {}) {
    await q.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1000);

    const questionType = await detectQuestionType(q);
    log(`      类型: ${questionType}`);

    const answers = await recognizeWithRetry(q, screenshotPath, questionType, page, log, 5, modelOptions);
    if (!answers || answers.length === 0) {
        log('      ⚠️ 识别失败，随机选择');
        const options = await q.locator('.ti-a').all();
        if (options.length > 0) {
            await options[Math.floor(Math.random() * options.length)].click();
        }
    } else {
        await clickAnswers(q, answers, log);
    }
}

// 点击选项
async function clickAnswers(q, answers, log) {
    for (const ans of answers) {
        const clean = ans.replace(/[\.\s○]/g, '');
        let option = await q.locator('.ti-a').filter({ hasText: clean + '.' }).first();
        if (await option.count() === 0) {
            option = await q.locator('.ti-a').filter({ hasText: clean }).first();
        }
        if (await option.count() > 0) {
            await option.click();
            log(`      ✅ 选择 ${ans}`);
        } else {
            log(`      ⚠️ 未找到选项 ${ans}`);
        }
    }
}

function findQuestions(page, log) {
    return (async () => {
        let qs = await page.locator('.queContainer').all();
        if (qs.length > 0) return qs;
        for (const frame of page.frames()) {
            try {
                qs = await frame.locator('.queContainer').all();
                if (qs.length > 0) {
                    log('🔎 在 Iframe 中找到题目');
                    return qs;
                }
            } catch {}
        }
        return [];
    })();
}

async function detectQuestionType(q) {
    const typeText = await q.evaluate(el => {
        let curr = el.previousElementSibling;
        while (curr) {
            if (curr.classList.contains('queItems-type')) return curr.innerText;
            curr = curr.previousElementSibling;
        }
        return '';
    });
    if (typeText.includes('单选')) return '单选题';
    if (typeText.includes('多选')) return '多选题';
    if (typeText.includes('判断')) return '判断题';
    return '选择题';
}

async function recognizeWithRetry(q, screenshotPath, questionType, page, log, maxRetries = 5, modelOptions = {}) {
    for (let i = 0; i < maxRetries; i++) {
        await q.screenshot({ path: screenshotPath });

        const answers = await getAnswersFromImage(screenshotPath, questionType, log, modelOptions);
        if (answers?.length > 0) {
            log(`      🎯 答案: ${answers.join(', ')}`);
            return answers;
        }

        log(`      ⚠️ 识别失败 (${i + 1}/${maxRetries})`);
        if (i < maxRetries - 1) await page.waitForTimeout(2000);
    }
    return [];
}

async function checkFailDialog(page, log) {
    const checkFn = () => {
        // 检查 layui 弹窗
        for (const dialog of document.querySelectorAll('.layui-layer-content')) {
            const text = (dialog.innerText || '').trim();
            if (text.includes('请重新提交测验') || text.includes('重新提交')) return text;
        }
        // 全页面搜索关键词
        const body = (document.body && document.body.innerText) || '';
        if (body.includes('请重新提交测验')) return '请重新提交测验';
        return null;
    };

    try {
        // 检查主页面
        let msg = await page.evaluate(checkFn);
        if (msg) { log(`📊 检测到未通过提示: ${msg}`); return msg; }

        // 检查所有 iframe
        for (const frame of page.frames()) {
            try {
                msg = await frame.evaluate(checkFn);
                if (msg) { log(`📊 检测到未通过提示 (在 iframe 中): ${msg}`); return msg; }
            } catch {}
        }
        return null;
    } catch {
        return null;
    }
}

async function clearAllSelections(page, log) {
    log('🧹 清空所有已选选项...');

    // 取消勾选所有复选框
    const checkedCheckboxes = page.locator('input[type="checkbox"]:checked');
    const checkboxCount = await checkedCheckboxes.count();
    for (let i = 0; i < checkboxCount; i++) {
        try { await checkedCheckboxes.nth(i).uncheck({ force: true }); } catch {}
    }

    // 强制清空所有单选框
    await page.evaluate(() => {
        document.querySelectorAll('input[type="radio"]:checked').forEach(radio => {
            radio.checked = false;
        });
    });

    // 同时处理 iframe 中的选项
    for (const frame of page.frames()) {
        try {
            await frame.evaluate(() => {
                document.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => {
                    cb.checked = false;
                });
                document.querySelectorAll('input[type="radio"]:checked').forEach(radio => {
                    radio.checked = false;
                });
            });
        } catch {}
    }

    log('✅ 已清空所有选项');
}

// 清空指定题目（按 name）的选项
async function clearSelectionsByName(page, name) {
    const clearFn = function (qName) {
        for (const inp of document.querySelectorAll(`input[name="${qName}"]`)) {
            inp.checked = false;
        }
    };
    await page.evaluate(clearFn, name);
    for (const frame of page.frames()) {
        try { await frame.evaluate(clearFn, name); } catch {}
    }
}

// ======================== 暴力遍历兜底策略 ========================

// 从页面提取每道题的得分情况
async function getQuestionResults(page) {
    const extractFn = function () {
        const results = [];
        for (const container of document.querySelectorAll('.queContainer')) {
            const input = container.querySelector('input[type="radio"], input[type="checkbox"]');
            if (!input) continue;
            const name = input.name;
            const type = input.type; // 'radio' or 'checkbox'

            // 解析得分：.scores .color-red 内容形如 " / 0" 或 " / 20.00"
            const scoreSpan = container.querySelector('.scores .color-red');
            let gotScore = false;
            if (scoreSpan) {
                const m = scoreSpan.textContent.match(/\/\s*([\d.]+)/);
                if (m) gotScore = parseFloat(m[1]) > 0;
            }

            const allValues = [];
            const selectedValues = [];
            for (const inp of container.querySelectorAll(`input[name="${name}"]`)) {
                allValues.push(inp.value);
                if (inp.checked) selectedValues.push(inp.value);
            }

            results.push({ name, type, isWrong: !gotScore, allValues, selectedValues });
        }
        return results;
    };

    let results = await page.evaluate(extractFn);
    if (results.length > 0) return results;

    for (const frame of page.frames()) {
        try {
            results = await frame.evaluate(extractFn);
            if (results.length > 0) return results;
        } catch {}
    }
    return [];
}

// 为一道题生成所有候选答案组合
function generateCombinations(values, type) {
    if (type === 'radio') {
        // 单选 / 判断：每个值单独一组
        return values.map(v => [v]);
    }
    // 多选：所有非空子集，按子集大小 2→3→…→1 排序（多选题通常 ≥2 个答案）
    const combos = [];
    const n = values.length;
    for (let mask = 1; mask < (1 << n); mask++) {
        const combo = [];
        for (let i = 0; i < n; i++) {
            if (mask & (1 << i)) combo.push(values[i]);
        }
        combos.push(combo);
    }
    combos.sort((a, b) => {
        const sa = a.length === 1 ? 999 : a.length;
        const sb = b.length === 1 ? 999 : b.length;
        return sa - sb;
    });
    return combos;
}

// 通过 name+value 在页面（含 iframe）中点击对应选项
async function applyAnswers(page, answersMap, log) {
    const contexts = [page, ...page.frames()];
    for (const [name, values] of Object.entries(answersMap)) {
        if (!values || values.length === 0) continue;
        for (const value of values) {
            for (const ctx of contexts) {
                try {
                    const input = ctx.locator(`input[name="${name}"][value="${value}"]`);
                    if (await input.count() > 0) {
                        await input.click({ force: true });
                        await page.waitForTimeout(300);
                        break;
                    }
                } catch {}
            }
        }
    }
}

// 提交试卷并返回是否通过
async function submitAndCheck(page, log, locate) {
    log('📝 提交试卷...');
    try {
        const btn = await locate('button:has-text("提交试卷")');
        if (btn) await btn.click();
    } catch {
        const btn = await locate('button:has-text("提交试卷")');
        if (btn) await btn.click();
    }
    await page.waitForTimeout(3000);

    await handleCaptcha(page, locate, async () => {
        const btn = await locate('div.btn.btn-warning:has-text("提交")');
        if (!btn) return false;
        return !(await btn.evaluate(el => el.classList.contains('disabled') || el.disabled));
    }, 10, log);

    const finalBtn = await locate('div.btn.btn-warning:has-text("提交")');
    if (finalBtn) {
        try {
            await humanClick(page, finalBtn);
            log('✅ 已提交');
        } catch (e) {
            log(`❌ 提交失败: ${e.message}`);
            return false;
        }
    }

    await page.waitForTimeout(3000);
    const failMsg = await checkFailDialog(page, log);
    return !failMsg;
}

// 暴力遍历：逐题尝试所有选项组合
async function bruteForceWrongQuestions(page, log, locate) {
    log('🔨 LLM 重试均未通过，启动暴力遍历策略...');

    // 等待弹窗自动消失
    await page.waitForTimeout(4000);

    // 获取当前各题得分
    const results = await getQuestionResults(page);
    if (results.length === 0) {
        log('⚠️ 无法获取题目得分信息，跳过暴力遍历');
        return;
    }

    const wrongQuestions = results.filter(r => r.isWrong);
    log(`📊 得分情况: ${results.length} 题，其中 ${wrongQuestions.length} 题未得分`);

    if (wrongQuestions.length === 0) {
        log('✅ 所有题目均已得分');
        return;
    }

    // 保存各题当前选中值（正确题保持不变）
    const savedAnswers = {};
    for (const q of results) {
        savedAnswers[q.name] = q.selectedValues;
    }

    // 逐个爆破未得分题目
    for (const wrongQ of wrongQuestions) {
        const combos = generateCombinations(wrongQ.allValues, wrongQ.type);

        // 排除已经试过的组合
        const triedKey = wrongQ.selectedValues.slice().sort().join(',');
        const remaining = combos.filter(c => c.slice().sort().join(',') !== triedKey);

        log(`🔨 爆破题目 [name=${wrongQ.name}]，类型: ${wrongQ.type}，剩余 ${remaining.length} 种组合`);

        let questionFixed = false;
        for (let ci = 0; ci < remaining.length; ci++) {
            const combo = remaining[ci];
            log(`   🎯 尝试组合 ${ci + 1}/${remaining.length}: [${combo.join(', ')}]`);

            // 只清空当前错题的选项，重新选择
            await clearSelectionsByName(page, wrongQ.name);
            await page.waitForTimeout(500);
            await applyAnswers(page, { [wrongQ.name]: combo }, log);
            await page.waitForTimeout(2000);

            // 提交并检测
            const passed = await submitAndCheck(page, log, locate);
            if (passed) {
                log('✅ 暴力遍历成功，测验已通过！');
                return;
            }

            // 检查本题是否已得分
            await page.waitForTimeout(3000);
            const newResults = await getQuestionResults(page);
            const thisQ = newResults.find(r => r.name === wrongQ.name);
            if (thisQ && !thisQ.isWrong) {
                log(`   ✅ 题目 [name=${wrongQ.name}] 已得分，保存答案，继续下一题`);
                savedAnswers[wrongQ.name] = combo;
                questionFixed = true;
                break;
            }
        }

        if (!questionFixed) {
            log(`   ⚠️ 题目 [name=${wrongQ.name}] 所有组合均未得分，跳过`);
        }
    }

    log('⚠️ 暴力遍历结束');
}

module.exports = { processQuizQuestions, clickQuizTaskIfAvailable };
