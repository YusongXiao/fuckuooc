# AGENTS.md

## 项目概览

- 本项目使用 Node.js 24 和 Playwright，实现 UOOC 网页流程自动化。
- `start.js` 是入口；主要逻辑位于 `utils/`。
- 配置模板为 `config.txt.expample`，运行时配置为 `config.txt`。

## 常用命令

```bash
npm install
npx playwright install chromium
node start.js
```

## 改动要求

- 只需完成用户要求的功能的最小化更改，无需做过多测试和防御性编程
- 保持现有 CommonJS 风格和简洁的 JavaScript 写法。
- 优先做小范围修改，不随意重构无关代码。
- 修改页面交互逻辑时，注意等待、重试和异常处理。
- 若行为、配置或使用方式发生变化，同步更新 `README.md`。
- 改动完某一个功能或者修复完某一个bug，输出一个简洁的english commit message（使用gitmoji）

## 安全

- 不要提交账号、密码、API Key、Cookie、截图或用户运行数据。
- 不要覆盖用户的 `config.txt` 和 `data/` 内容。
