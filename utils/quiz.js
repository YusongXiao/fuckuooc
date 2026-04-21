const path = require('path');
const { DATA_DIR, RETRY_MODEL } = require('./config');
const { locateInAnyFrame, humanClick, handleCaptcha } = require('./browser');
const { getAnswersFromImage, getTextAnswersFromImage } = require('./module');

async function clickQuizTaskIfAvailable(page) {
    return page.evaluate(() => {
        for (const block of document.querySelectorAll('.basic')) {
            if (block.classList.contains('complete') || block.dataset.quizHandled === '1') continue;
            const tag = block.querySelector('.tag-source-name');
            if (!tag) continue;
            const label = tag.innerText.trim().replace(/\s+/g, '');
            if (!label.includes('测验') && !label.includes('测试') && !label.toLowerCase().includes('quiz')) continue;
            try {
                block.scrollIntoView({ block: 'center' });
            } catch {}
            block.click();
            block.dataset.quizHandled = '1';
            return true;
        }
        return false;
    });
}

async function processQuizQuestions(page, log, courseId) {
    const screenshotPath = path.join(DATA_DIR, `image_${courseId}.png`);

    log('🧠 开始处理测验...');
    await page.waitForTimeout(5000);

    const locate = selector => locateInAnyFrame(page, selector);
    const submitPaperBtn = await locate('button:has-text("提交试卷")');
    if (!submitPaperBtn) {
        log('⚠️ 未找到 [提交试卷]，跳过');
        return;
    }
    log('✅ 发现 [提交试卷]，开始做题...');

    let quizPassed = false;
    const maxAttempts = 2;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const isRetry = attempt > 0;
        let modelOptions = isRetry
            ? { model: RETRY_MODEL, reasoningEffort: 'high' }
            : { reasoningEffort: 'medium' };

        if (isRetry) {
            log(`🔁 重做测验（第 ${attempt + 1} 次，使用 ${RETRY_MODEL}）...`);
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

        log(`   共 ${questions.length} 道题`);

        if (!isRetry) {
            const hasExistingAnswers = await hasAnyExistingAnswer(questions);
            if (hasExistingAnswers) {
                log(`⚠️ 检测到已有作答痕迹，先清空后用 ${RETRY_MODEL} 重做`);
                await clearAllSelections(page, log);
                await page.waitForTimeout(1000);
                modelOptions = { model: RETRY_MODEL, reasoningEffort: 'high' };
            }
        }

        for (let index = 0; index < questions.length; index++) {
            const question = questions[index];
            log(`   📝 第 ${index + 1}/${questions.length} 题`);

            try {
                await Promise.race([
                    answerOneQuestion(question, page, log, screenshotPath, modelOptions),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('单题超时')), 180000))
                ]);
            } catch (err) {
                log(`      ❌ 失败: ${err.message}`);
            }

            await page.waitForTimeout(1200);
        }

        log('📤 提交试卷...');
        try {
            const button = await locate('button:has-text("提交试卷")');
            if (button) await button.click();
        } catch {
            const button = await locate('button:has-text("提交试卷")');
            if (button) await button.click();
        }
        await page.waitForTimeout(3000);

        await handleCaptcha(page, locate, async () => {
            const button = await locate('div.btn.btn-warning:has-text("提交"), button.btn.btn-warning:has-text("提交")');
            if (!button) return false;
            return !(await button.evaluate(element => element.classList.contains('disabled') || element.disabled));
        }, 10, log);

        const finalBtn = await locate('div.btn.btn-warning:has-text("提交"), button.btn.btn-warning:has-text("提交")');
        if (finalBtn) {
            try {
                await humanClick(page, finalBtn);
                log('✅ 已提交');
            } catch (err) {
                log(`❌ 提交失败: ${err.message}`);
                break;
            }
        }

        await page.waitForTimeout(3000);
        const failMsg = await checkFailDialog(page, log);
        if (failMsg) {
            log(`⚠️ 测验未通过: ${failMsg}`);
            if (attempt < maxAttempts - 1) {
                await page.waitForTimeout(3000);
                continue;
            }
            log('⚠️ 重试次数已达上限');
        } else {
            log('✅ 测验提交成功');
            quizPassed = true;
            break;
        }
    }

    if (!quizPassed) {
        await bruteForceWrongQuestions(page, log, locate);
    }

    await page.waitForTimeout(3000);
}

async function hasAnyExistingAnswer(questions) {
    for (const question of questions) {
        const answered = await question.evaluate(element => {
            if (element.querySelector('input[type="radio"]:checked, input[type="checkbox"]:checked')) return true;
            if (Array.from(element.querySelectorAll('input[type="text"], input[type="search"], input:not([type]), textarea')).some(node => (node.value || '').trim())) return true;
            return false;
        }).catch(() => false);
        if (answered) return true;
    }
    return false;
}

async function answerOneQuestion(question, page, log, screenshotPath, modelOptions = {}) {
    await question.scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);

    const meta = await detectQuestionMeta(question);
    log(`      类型: ${meta.questionType}`);

    if (['单选题', '多选题', '判断题'].includes(meta.questionType)) {
        const answers = await recognizeChoiceAnswers(question, page, screenshotPath, meta.questionType, log, modelOptions);
        if (!answers.length) {
            log('      ⚠️ 识别失败，随机选择一个选项');
            const options = await question.locator('.ti-a').all();
            if (options.length > 0) {
                await options[Math.floor(Math.random() * options.length)].click();
            }
            return;
        }
        await clickChoiceAnswers(question, answers, log);
        return;
    }

    if (['填空题', '名词解释', '问答题', '论述题'].includes(meta.questionType)) {
        const answerCount = Math.max(1, meta.textInputs.length, meta.ueContainers.length);
        const answers = await recognizeTextAnswers(question, page, screenshotPath, meta.questionType, answerCount, log, modelOptions);
        if (!answers.length) {
            log('      ⚠️ 未识别到文本答案');
            return;
        }
        await fillTextAnswers(question, meta, answers, log);
        return;
    }

    log(`      ⚠️ 暂未支持题型: ${meta.questionType}`);
}

async function detectQuestionMeta(question) {
    return question.evaluate(element => {
        const typeText = (() => {
            let current = element.previousElementSibling;
            while (current) {
                if (current.classList.contains('queItems-type')) return (current.innerText || '').trim();
                current = current.previousElementSibling;
            }
            return '';
        })();

        const questionId = (() => {
            const index = element.querySelector('.index[id^="anchor"]');
            if (!index) return '';
            return String(index.id || '').replace(/^anchor/, '');
        })();

        const radioCount = element.querySelectorAll('input[type="radio"]').length;
        const checkboxCount = element.querySelectorAll('input[type="checkbox"]').length;
        const textInputs = Array.from(element.querySelectorAll('input[type="text"], input[type="search"], input:not([type]), textarea'))
            .map(node => ({ id: node.id || '', tag: node.tagName, type: node.type || '', placeholder: node.placeholder || '' }));
        const ueContainers = Array.from(element.querySelectorAll('.ue-container, textarea.ue-container, script.ue-container, div[id^="u"], textarea[id^="u"]'))
            .map(node => ({ id: node.id || '', tag: node.tagName, cls: node.className || '' }))
            .filter(node => node.id);

        let questionType = '未知题型';
        if (typeText.includes('填空')) questionType = '填空题';
        else if (typeText.includes('名词解释')) questionType = '名词解释';
        else if (typeText.includes('问答')) questionType = '问答题';
        else if (typeText.includes('论述')) questionType = '论述题';
        else if (typeText.includes('多选')) questionType = '多选题';
        else if (typeText.includes('判断')) questionType = '判断题';
        else if (typeText.includes('单选')) questionType = '单选题';
        else if (checkboxCount > 0) questionType = '多选题';
        else if (radioCount > 0) {
            const optionTexts = Array.from(element.querySelectorAll('.ti-a')).map(option => (option.innerText || '').replace(/\s+/g, ' ').trim());
            const isJudge = optionTexts.length === 2 &&
                optionTexts.some(option => option.includes('正确')) &&
                optionTexts.some(option => option.includes('错误'));
            questionType = isJudge ? '判断题' : '单选题';
        } else if (textInputs.length > 1 || ueContainers.length > 1) {
            questionType = '填空题';
        } else if (textInputs.length > 0 || ueContainers.length > 0) {
            questionType = '问答题';
        }

        return {
            questionId,
            questionType,
            textInputs,
            ueContainers
        };
    });
}

async function recognizeChoiceAnswers(question, page, screenshotPath, questionType, log, modelOptions = {}) {
    for (let attempt = 1; attempt <= 5; attempt++) {
        await question.screenshot({ path: screenshotPath });
        const answers = await getAnswersFromImage(screenshotPath, questionType, log, modelOptions);
        if (answers?.length > 0) {
            log(`      🎯 答案: ${answers.join(', ')}`);
            return answers;
        }
        log(`      ⚠️ 识别失败 (${attempt}/5)`);
        if (attempt < 5) await page.waitForTimeout(1500);
    }
    return [];
}

async function recognizeTextAnswers(question, page, screenshotPath, questionType, answerCount, log, modelOptions = {}) {
    for (let attempt = 1; attempt <= 5; attempt++) {
        await question.screenshot({ path: screenshotPath });
        const answers = await getTextAnswersFromImage(screenshotPath, questionType, answerCount, log, modelOptions);
        if (answers?.length > 0) {
            log(`      🎯 文本答案: ${answers.join(' | ')}`);
            return answers;
        }
        log(`      ⚠️ 文本识别失败 (${attempt}/5)`);
        if (attempt < 5) await page.waitForTimeout(1500);
    }
    return [];
}

async function clickChoiceAnswers(question, answers, log) {
    for (const answer of answers) {
        const clean = String(answer || '').replace(/[.\s、]/g, '');
        let option = question.locator('.ti-a').filter({ hasText: `${clean}.` }).first();
        if (await option.count() === 0) {
            option = question.locator('.ti-a').filter({ hasText: clean }).first();
        }
        if (await option.count() > 0) {
            await option.click();
            log(`      ✅ 选择 ${answer}`);
        } else {
            log(`      ⚠️ 未找到选项 ${answer}`);
        }
    }
}

async function fillTextAnswers(question, meta, answers, log) {
    const textInputs = question.locator('input[type="text"], input[type="search"], input:not([type]), textarea');
    const textInputCount = await textInputs.count();
    let filled = 0;

    for (let index = 0; index < textInputCount; index++) {
        const answer = answers[index] || answers[0];
        if (!answer) continue;
        await textInputs.nth(index).fill(answer);
        filled++;
        log(`      ✅ 填写文本框 ${index + 1}: ${answer}`);
    }

    const ueIds = [...new Set(meta.ueContainers.map(item => item.id).filter(Boolean))];
    if (ueIds.length > 0) {
        await question.evaluate((element, payload) => {
            const doc = element.ownerDocument;
            const win = doc.defaultView;
            payload.ids.forEach((id, index) => {
                const value = payload.values[index] || payload.values[0] || '';
                const editor = win.UE && win.UE.getEditor ? win.UE.getEditor(id) : null;
                if (editor && typeof editor.ready === 'function') {
                    editor.ready(() => editor.setContent(value));
                }
                const plainNode = doc.getElementById(id);
                if (plainNode && 'value' in plainNode) {
                    plainNode.value = value;
                }
            });
        }, { ids: ueIds, values: answers });

        ueIds.forEach((id, index) => {
            const answer = answers[index] || answers[0] || '';
            if (!answer) return;
            filled++;
            log(`      ✅ 填写编辑器 ${id}: ${answer}`);
        });
    }

    if (!filled) {
        log('      ⚠️ 没找到可填写的填空/问答控件');
    }
}

function findQuestions(page, log) {
    return (async () => {
        let questions = await page.locator('.queContainer').all();
        if (questions.length > 0) return questions;
        for (const frame of page.frames()) {
            try {
                questions = await frame.locator('.queContainer').all();
                if (questions.length > 0) {
                    log('📷 在 iframe 中找到题目');
                    return questions;
                }
            } catch {}
        }
        return [];
    })();
}

async function checkFailDialog(page, log) {
    const checkFn = () => {
        for (const dialog of document.querySelectorAll('.layui-layer-content')) {
            const text = (dialog.innerText || '').trim();
            if (text.includes('请重新提交测验') || text.includes('重新提交')) return text;
        }
        const bodyText = (document.body && document.body.innerText) || '';
        if (bodyText.includes('请重新提交测验')) return '请重新提交测验';
        return null;
    };

    try {
        let msg = await page.evaluate(checkFn);
        if (msg) {
            log(`📋 检测到未通过提示: ${msg}`);
            return msg;
        }
        for (const frame of page.frames()) {
            try {
                msg = await frame.evaluate(checkFn);
                if (msg) {
                    log(`📋 在 iframe 中检测到未通过提示: ${msg}`);
                    return msg;
                }
            } catch {}
        }
        return null;
    } catch {
        return null;
    }
}

async function clearAllSelections(page, log) {
    log('🧹 清空已有答案...');

    const checkedCheckboxes = page.locator('input[type="checkbox"]:checked');
    const checkboxCount = await checkedCheckboxes.count();
    for (let index = 0; index < checkboxCount; index++) {
        try {
            await checkedCheckboxes.nth(index).uncheck({ force: true });
        } catch {}
    }

    await page.evaluate(() => {
        document.querySelectorAll('input[type="radio"]:checked').forEach(node => {
            node.checked = false;
        });
        document.querySelectorAll('input[type="text"], input[type="search"], input:not([type]), textarea').forEach(node => {
            node.value = '';
        });
        document.querySelectorAll('.ue-container, textarea.ue-container, script.ue-container, div[id^="u"], textarea[id^="u"]').forEach(node => {
            if (node.id && window.UE && window.UE.getEditor) {
                try {
                    const editor = window.UE.getEditor(node.id);
                    if (editor && typeof editor.ready === 'function') {
                        editor.ready(() => editor.setContent(''));
                    }
                } catch {}
            }
            if ('value' in node) {
                node.value = '';
            }
        });
    });

    for (const frame of page.frames()) {
        try {
            await frame.evaluate(() => {
                document.querySelectorAll('input[type="checkbox"]:checked').forEach(node => {
                    node.checked = false;
                });
                document.querySelectorAll('input[type="radio"]:checked').forEach(node => {
                    node.checked = false;
                });
                document.querySelectorAll('input[type="text"], input[type="search"], input:not([type]), textarea').forEach(node => {
                    node.value = '';
                });
                document.querySelectorAll('.ue-container, textarea.ue-container, script.ue-container, div[id^="u"], textarea[id^="u"]').forEach(node => {
                    if (node.id && window.UE && window.UE.getEditor) {
                        try {
                            const editor = window.UE.getEditor(node.id);
                            if (editor && typeof editor.ready === 'function') {
                                editor.ready(() => editor.setContent(''));
                            }
                        } catch {}
                    }
                    if ('value' in node) {
                        node.value = '';
                    }
                });
            });
        } catch {}
    }

    log('✅ 已清空已有答案');
}

async function clearSelectionsByName(page, name) {
    const clearFn = qName => {
        for (const input of document.querySelectorAll(`input[name="${qName}"]`)) {
            input.checked = false;
        }
    };
    await page.evaluate(clearFn, name);
    for (const frame of page.frames()) {
        try {
            await frame.evaluate(clearFn, name);
        } catch {}
    }
}

async function getQuestionResults(page) {
    const extractFn = () => {
        const results = [];
        for (const container of document.querySelectorAll('.queContainer')) {
            const input = container.querySelector('input[type="radio"], input[type="checkbox"]');
            if (!input) continue;
            const name = input.name;
            const type = input.type;

            const scoreSpan = container.querySelector('.scores .color-red');
            let gotScore = false;
            if (scoreSpan) {
                const matched = scoreSpan.textContent.match(/\/\s*([\d.]+)/);
                if (matched) gotScore = parseFloat(matched[1]) > 0;
            }

            const allValues = [];
            const selectedValues = [];
            for (const node of container.querySelectorAll(`input[name="${name}"]`)) {
                allValues.push(node.value);
                if (node.checked) selectedValues.push(node.value);
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

function generateCombinations(values, type) {
    if (type === 'radio') {
        return values.map(value => [value]);
    }
    const combinations = [];
    const size = values.length;
    for (let mask = 1; mask < (1 << size); mask++) {
        const combo = [];
        for (let index = 0; index < size; index++) {
            if (mask & (1 << index)) combo.push(values[index]);
        }
        combinations.push(combo);
    }
    combinations.sort((left, right) => {
        const lSize = left.length === 1 ? 999 : left.length;
        const rSize = right.length === 1 ? 999 : right.length;
        return lSize - rSize;
    });
    return combinations;
}

async function applyAnswers(page, answersMap) {
    const contexts = [page, ...page.frames()];
    for (const [name, values] of Object.entries(answersMap)) {
        if (!values || values.length === 0) continue;
        for (const value of values) {
            for (const context of contexts) {
                try {
                    const input = context.locator(`input[name="${name}"][value="${value}"]`);
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

async function submitAndCheck(page, log, locate) {
    log('📤 提交试卷...');
    try {
        const button = await locate('button:has-text("提交试卷")');
        if (button) await button.click();
    } catch {
        const button = await locate('button:has-text("提交试卷")');
        if (button) await button.click();
    }
    await page.waitForTimeout(3000);

    await handleCaptcha(page, locate, async () => {
        const button = await locate('div.btn.btn-warning:has-text("提交"), button.btn.btn-warning:has-text("提交")');
        if (!button) return false;
        return !(await button.evaluate(element => element.classList.contains('disabled') || element.disabled));
    }, 10, log);

    const finalBtn = await locate('div.btn.btn-warning:has-text("提交"), button.btn.btn-warning:has-text("提交")');
    if (finalBtn) {
        try {
            await humanClick(page, finalBtn);
            log('✅ 已提交');
        } catch (err) {
            log(`❌ 提交失败: ${err.message}`);
            return false;
        }
    }

    await page.waitForTimeout(3000);
    const failMsg = await checkFailDialog(page, log);
    return !failMsg;
}

async function bruteForceWrongQuestions(page, log, locate) {
    log('🛠️ LLM 重试仍未通过，启动客观题暴力遍历...');
    await page.waitForTimeout(4000);

    const results = await getQuestionResults(page);
    if (results.length === 0) {
        log('⚠️ 无法获取题目得分信息，跳过暴力遍历');
        return;
    }

    const wrongQuestions = results.filter(item => item.isWrong);
    log(`📋 得分情况: ${results.length} 题，其中 ${wrongQuestions.length} 题未得分`);
    if (wrongQuestions.length === 0) {
        log('✅ 所有客观题均已得分');
        return;
    }

    for (const wrongQuestion of wrongQuestions) {
        const combinations = generateCombinations(wrongQuestion.allValues, wrongQuestion.type);
        const triedKey = wrongQuestion.selectedValues.slice().sort().join(',');
        const remaining = combinations.filter(combo => combo.slice().sort().join(',') !== triedKey);

        log(`🛠️ 爆破题目 [name=${wrongQuestion.name}]，剩余 ${remaining.length} 组组合`);

        for (let index = 0; index < remaining.length; index++) {
            const combo = remaining[index];
            log(`   🎯 尝试组合 ${index + 1}/${remaining.length}: [${combo.join(', ')}]`);
            await clearSelectionsByName(page, wrongQuestion.name);
            await page.waitForTimeout(500);
            await applyAnswers(page, { [wrongQuestion.name]: combo });
            await page.waitForTimeout(1500);

            const passed = await submitAndCheck(page, log, locate);
            if (passed) {
                log('✅ 暴力遍历成功，测验通过');
                return;
            }

            await page.waitForTimeout(2000);
            const updatedResults = await getQuestionResults(page);
            const currentQuestion = updatedResults.find(item => item.name === wrongQuestion.name);
            if (currentQuestion && !currentQuestion.isWrong) {
                log(`   ✅ 题目 [name=${wrongQuestion.name}] 已得分`);
                break;
            }
        }
    }

    log('⚠️ 暴力遍历结束');
}

module.exports = { processQuizQuestions, clickQuizTaskIfAvailable };
