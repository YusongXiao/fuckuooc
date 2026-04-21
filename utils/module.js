const fs = require('fs');
const path = require('path');
const { API_KEY, MODEL_NAME, API_BASE_URL } = require('./config');

const QUIZ_PROMPT = '请仔细阅读图片中的题干和所有选项，分析并找出正确答案。如果选项前面是方框，就是多选题，圆框就是单选题。做题之前，你需要先判断这个题是单选题还是多选题。只要求返回一个 JSON 对象。如果这道题只需要一个答案或者只有一个正确答案，请放在数组 answers 里面。只返回一个 JSON，不要输出任何解释或者 markdown 代码块包裹。\n例如：{"answers":["A","C"]}。如果你无论如何都无法确定并且真的找不到，才返回 {"answers":[]}';

async function getAnswersFromImage(imagePath, questionType = '选择题', log, options = {}) {
    const _log = log || console.log;
    const modelName = options.model || MODEL_NAME;
    const thinkingLevel = options.reasoningEffort || 'medium';
    const absPath = path.resolve(imagePath);
    let imageBase64;
    try {
        imageBase64 = fs.readFileSync(absPath).toString('base64');
    } catch (err) {
        _log('❌ 读取图片失败:', err.message);
        return [];
    }

    const maxRetries = 3;
    const body = {
        model: modelName,
        temperature: 0,
        top_p: 1,
        reasoning_effort: thinkingLevel,
        messages: [{
            role: 'user',
            content: [
                { type: 'text', text: QUIZ_PROMPT + (questionType ? `\n\n题型提示：${questionType}` : '') },
                { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}` } }
            ]
        }]
    };

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            _log(`🤖 请求大模型识别 (${modelName}, thinking: ${thinkingLevel})...`);
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 600000);

            const resp = await fetch(API_BASE_URL, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body),
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (!resp.ok) {
                _log('❌ HTTP Error:', resp.status, await resp.text());
                _log(`🔄 5秒后重试... (${attempt + 1}/${maxRetries})`);
                await new Promise(r => setTimeout(r, 5000));
                continue;
            }

            const data = await resp.json();
            const content = data.choices?.[0]?.message?.content;
            let jsonText = '';
            if (typeof content === 'string') jsonText = content;
            else if (Array.isArray(content)) jsonText = (content.find(p => p.type === 'text') || content[0])?.text ?? '';

            jsonText = jsonText.replace(/```json/g, '').replace(/```/g, '').trim();
            const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
            if (jsonMatch) jsonText = jsonMatch[0];

            const parsed = JSON.parse(jsonText);
            _log('✅ 答案:', parsed.answers);
            return parsed.answers || [];
        } catch (err) {
            if (err.name === 'AbortError') {
                _log(`❌ 请求超时 (${attempt + 1}/${maxRetries})`);
            } else {
                _log(`❌ 请求出错: ${err.message} (${attempt + 1}/${maxRetries})`);
                await new Promise(r => setTimeout(r, 5000));
            }
        }
    }
    _log('⚠️ 大模型识别失败，已用尽重试次数');
    return [];
}

module.exports = { getAnswersFromImage };
