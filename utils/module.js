const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
const { API_KEY, MODEL_NAME, API_BASE_URL } = require('./config');

const QUIZ_PROMPT = '请仔细阅读图片中的题干和所有选项，分析并找出正确答案。如果选项前面是方框，就是多选题，圆框就是单选题。做题之前，你需要先判断这个题是单选题还是多选题。只要求返回一个 JSON 对象。如果这道题只需要一个答案或者只有一个正确答案，请放在数组 answers 里面。只返回一个 JSON，不要输出任何解释或者 markdown 代码块包裹。\n例如：{"answers":["A","C"]}。如果你无论如何都无法确定并且真的找不到，才返回 {"answers":[]}';
const TEXT_QUESTION_PROMPT = '请仔细阅读图片中的题干并直接作答。如果是填空题，按空格顺序将每个答案分别放入 answers 数组；如果是名词解释、问答题或论述题，给出准确、简洁、可直接填写的答案，并放入 answers 数组。只返回一个 JSON 对象，不要输出解释或 markdown 代码块。\n例如：{"answers":["第一空答案","第二空答案"]}。如果无法确定，才返回 {"answers":[]}';
const sdkBaseURL = API_BASE_URL.replace(/\/chat\/completions\/?$/, '');
const client = new OpenAI({
    apiKey: API_KEY,
    baseURL: sdkBaseURL,
    timeout: 600000,
    maxRetries: 0
});

function isUnsupportedModelOptionError(err) {
    const message = `${err.message || ''} ${JSON.stringify(err.error || '')}`;
    return err.status === 400 && /reasoning[_\s-]?effort|temperature|top[_\s-]?p/i.test(message);
}

async function getAnswersFromImage(imagePath, questionType = '选择题', log, options = {}) {
    const _log = log || console.log;
    const modelName = options.model || MODEL_NAME;
    const thinkingLevel = options.reasoningEffort || 'medium';
    const prompt = ['填空题', '名词解释', '问答题', '论述题'].includes(questionType)
        ? TEXT_QUESTION_PROMPT
        : QUIZ_PROMPT;
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
                { type: 'text', text: prompt + (questionType ? `\n\n题型提示：${questionType}` : '') },
                { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}` } }
            ]
        }]
    };
    let useModelOptions = true;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const optionInfo = useModelOptions ? `thinking: ${thinkingLevel}` : '通用参数';
            _log(`🤖 请求大模型识别 (${modelName}, ${optionInfo})...`);
            const requestBody = useModelOptions
                ? body
                : { model: body.model, messages: body.messages };
            const data = await client.chat.completions.create(requestBody);
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
            if (useModelOptions && isUnsupportedModelOptionError(err)) {
                useModelOptions = false;
                _log('⚠️ 当前模型不支持推理或采样参数，将使用通用参数重试');
            } else if (err.name === 'APIConnectionTimeoutError') {
                _log(`❌ 请求超时 (${attempt + 1}/${maxRetries})`);
            } else if (err.status) {
                _log('❌ HTTP Error:', err.status, err.message);
            } else {
                _log(`❌ 请求出错: ${err.message} (${attempt + 1}/${maxRetries})`);
            }
            if (attempt < maxRetries - 1) {
                _log(`🔄 5秒后重试... (${attempt + 1}/${maxRetries})`);
                await new Promise(r => setTimeout(r, 5000));
            }
        }
    }
    _log('⚠️ 大模型识别失败，已用尽重试次数');
    return [];
}

module.exports = { getAnswersFromImage };
