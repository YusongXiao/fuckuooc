const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./config');

function normalizeUrl(url) {
    if (!url) return null;
    try {
        const decoded = decodeURIComponent(url);
        return new URL(decoded.split('?')[0]).pathname;
    } catch {
        return decodeURIComponent(url);
    }
}

function getVideoSrc(page) {
    return page.evaluate(() => {
        const v = document.querySelector('video');
        return v ? (v.currentSrc || v.src || null) : null;
    });
}

class VideoTracker {
    constructor(courseId, log) {
        this.courseId = courseId;
        this.log = log;
        this.watched = new Set();
        const logFile = path.join(DATA_DIR, `${courseId}.txt`);
        if (fs.existsSync(logFile)) {
            const lines = fs.readFileSync(logFile, 'utf-8').split('\n').filter(l => l.trim());
            lines.forEach(l => this.watched.add(l.trim()));
            log(`📖 已加载观看记录，共 ${this.watched.size} 条`);
        } else {
            log('🆕 无历史记录');
        }
    }

    isWatched(src) {
        return this.watched.has(normalizeUrl(src));
    }

    async markCurrentWatched(page) {
        const src = await getVideoSrc(page);
        if (!src) return;
        const normalized = normalizeUrl(src);
        this.watched.add(normalized);
        fs.appendFileSync(path.join(DATA_DIR, `${this.courseId}.txt`), normalized + '\n', 'utf-8');
        this.log('✅ 记录已刷视频');
    }

    async findUnwatchedVideo(page) {
        await page.waitForTimeout(3000);

        const currentSrc = await getVideoSrc(page);
        if (currentSrc && !this.isWatched(currentSrc)) return true;

        const iconCount = await page.evaluate(() => {
            const active = document.querySelector('.oneline.ng-binding.active') || document.querySelector('.oneline.active');
            if (!active) return 0;
            const li = active.closest('li');
            if (!li) return 0;
            const icons = li.querySelectorAll('.icon-video');
            return icons ? icons.length : 0;
        });

        if (iconCount === 0) return false;
        this.log(`   🔎 ${iconCount} 个视频图标，逐个检查...`);

        for (let i = 0; i < iconCount; i++) {
            await page.evaluate((index) => {
                const active = document.querySelector('.oneline.ng-binding.active') || document.querySelector('.oneline.active');
                if (!active) return;
                const li = active.closest('li');
                const icons = li.querySelectorAll('.icon-video');
                if (icons?.[index]) {
                    const icon = icons[index];
                    try { icon.scrollIntoView({ block: 'center' }); } catch {}
                    (icon.closest('.basic') || icon).click();
                }
            }, i);

            try {
                await page.locator('video').first().waitFor({ state: 'visible', timeout: 5000 });
            } catch { continue; }

            await page.waitForTimeout(3000);
            const src = await getVideoSrc(page);
            if (src && !this.isWatched(src)) {
                this.log(`   ✅ 第 ${i + 1} 个视频是新的`);
                return true;
            }
        }
        return false;
    }

    async playVideo(page) {
        let quizCount = 0;
        const solvedQuizIds = new Set(); // 记录已破解的测验 ID，避免重复破解

        while (true) {
            if (await page.locator('#quizLayer').isVisible().catch(() => false)) {
                // 通过 input name 属性识别当前测验
                const quizId = await page.evaluate(() => {
                    const input = document.querySelector('#quizLayer input[name]');
                    return input ? input.name : null;
                });
                if (quizId && solvedQuizIds.has(quizId)) {
                    // 已破解过的测验重新出现，跳过
                } else {
                    this.log(`📝 视频内测验 #${++quizCount}`);
                    await handleVideoQuiz(page, this.log);
                    if (quizId) solvedQuizIds.add(quizId);
                }
                await page.waitForTimeout(1000);
            }

            const status = await page.evaluate(() => {
                const v = document.querySelector('video');
                if (!v) return { ended: true, reason: 'not_found' };

                v.muted = true;
                if (v.paused) v.play().catch(() => {});
                if (v.playbackRate !== 2.0) v.playbackRate = 2.0;

                const valid = v.duration > 0 && !isNaN(v.duration) && v.duration !== Infinity;
                let ended = v.ended, reason = v.ended ? 'ended' : '';

                if (!ended && valid) {
                    const ratio = v.currentTime / v.duration;
                    const remaining = v.duration - v.currentTime;
                    if (ratio > 0.985) { ended = true; reason = `ratio_${ratio.toFixed(3)}`; }
                    else if (remaining < 3) { ended = true; reason = `remaining_${remaining.toFixed(1)}`; }
                }

                return {
                    ended, reason,
                    currentTime: v.currentTime,
                    duration: v.duration,
                    paused: v.paused,
                    src: v.currentSrc || v.src
                };
            });

            if (status.src && this.isWatched(status.src)) {
                this.log('⚠️ 已看视频，跳过');
                break;
            }
            if (status.ended) {
                this.log(`✅ 视频结束 (${status.reason})`);
                break;
            }

            const dur = isNaN(status.duration) ? '...' : status.duration.toFixed(1);
            this.log(`   ▶️ ${status.currentTime.toFixed(1)} / ${dur}`);
            await page.waitForTimeout(2500);
        }
    }
}

async function handleVideoQuiz(page, log) {
    const layer = page.locator('#quizLayer');
    try {
        await layer.locator('input').first().waitFor({ state: 'attached', timeout: 3000 });
    } catch { return; }

    const inputs = await layer.locator('input').all();
    const submitBtn = layer.locator('button.btn-success');
    const n = inputs.length;
    log(`   🧩 ${n} 个选项，暴力破解...`);

    for (let i = 1; i < (1 << n); i++) {
        if (!await layer.isVisible().catch(() => false)) {
            log('   ✅ 测验通过');
            return;
        }
        for (let j = 0; j < n; j++) {
            const checked = await inputs[j].isChecked();
            if (((i >> j) & 1) !== (checked ? 1 : 0)) {
                await inputs[j].click({ force: true });
            }
        }
        await submitBtn.click();
        await page.waitForTimeout(500);
        if (!await layer.isVisible().catch(() => false)) {
            log(`   ✅ 破解成功 (${i.toString(2)})`);
            return;
        }
    }
    log('✅');
}

module.exports = { VideoTracker };
