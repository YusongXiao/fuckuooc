# fuckuooc

一键全自动完成 [UOOC 联盟](https://www.uooc.net.cn/) 课程学习，包括视频观看、视频内弹题、测验答题。运行后可最小化窗口，去做自己的事情。

## ✨ Features

- **自动登录并通过人机验证** — 模拟真人鼠标轨迹，自动完成阿里云智能验证
- **自动扫描待学习课程** — 登录后自动收集所有需要完成的课程
- **三课程并行** — 默认同时进行 3 个课程，多开标签页互不干扰
- **自动完成视频内测验** — 视频播放中弹出的小测验，穷举选项组合自动破解
- **自动完成视频后测验** — 截图题目 → 多模态大模型识图答题 → 自动提交，并通过人机验证
- **答错自动重做 + 暴力兜底** — 测验未通过时自动切换更强模型重做；仍未通过则逐题穷举选项组合，直到通过
- **真正的无人值守** — `node start.js` 之后最小化控制台和浏览器窗口即可，脚本全程自动运行

## 🎬 演示

**自动登录：**

<img src="https://oss.songhappy.cn/fuckuooc/auto_login.gif" width="720" alt="自动登录演示">

**登录后自动同时刷三个课程：**

<img src="https://oss.songhappy.cn/fuckuooc/auto_three_class.gif" width="720" alt="三课程并行演示">

**自动完成视频内测验：**

<img src="https://oss.songhappy.cn/fuckuooc/auto_in_video_test.gif" width="720" alt="视频内测验演示">

**自动完成视频后测验：**

<img src="https://oss.songhappy.cn/fuckuooc/auto_test.gif" width="720" alt="章节测验演示">

## 🚀 快速开始

> **环境要求**：Node.js >= 18（代码使用了原生 `fetch`）

### 1. 克隆项目

```bash
git clone https://github.com/YusongXiao/fuckuooc
cd fuckuooc
```

### 2. 安装依赖

```bash
npm install
npx playwright install chromium
```

### 3. 编辑配置

打开项目根目录下的 `config.txt`，填写你的信息：

```ini
# UOOC 账号
USERNAME=你的手机号
PASSWORD=你的密码

# LLM 配置
API_KEY=你的火山引擎API密钥
```

API 密钥从火山引擎获取：<https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey>（低价 / 免费使用，详见下方[免费获取 API Key](#-免费获取火山引擎-api-key)）

其他配置项（模型名称、API 地址等）已有默认值，一般无需修改。完整配置说明见下方[配置参考](#配置参考)。

### 4. 运行

```bash
node start.js
```

脚本启动后会自动打开浏览器完成登录、刷课、答题。你可以**最小化控制台和浏览器窗口**，去做自己的事。

---

## 📋 支持范围

| 类型 | 支持情况 | 说明 |
|---|---|---|
| 视频播放 | ✅ 支持 | 自动进入课程、定位未看视频、2 倍速静音播放并记录进度 |
| 视频中弹出测验 | ✅ 支持 | 穷举选项组合自动提交，直到通过 |
| 视频后测验 | ✅ 支持 | 截图题目 → 多模态大模型识图答题 → 自动提交 |
| 讨论 | ❌ 不支持 | 需要人工参与 |
| 考试 | ❌ 不支持 | 不会自动参与或提交考试 |
| 作业 | ❌ 不支持 | 不会自动完成作业内容 |

---

## ⚠️ 注意事项

### 模型要求与限制

> **本项目仅在火山引擎平台 + doubao 系列模型下经过测试，其他模型或平台不保证可用性。**

脚本要求模型具备以下能力：

1. **支持图片输入 / 多模态理解** — 需要读取题目截图
2. **兼容 OpenAI Chat Completions 接口格式** — 脚本使用标准 OpenAI 请求体
3. **支持深度思考**（`thinking` 参数）— 用于提升答题准确率

理论上支持任何 OpenAI 格式的 API 地址。如果你使用其他平台遇到兼容性问题，可以尝试手动修改 `utils/module.js` 中的请求参数。

### 配置参考

`config.txt` 支持以下字段（也可通过环境变量设置，config.txt 优先）：

| 字段 | 说明 | 默认值 |
|---|---|---|
| `USERNAME` | UOOC 登录手机号 | （必填） |
| `PASSWORD` | UOOC 登录密码 | （必填） |
| `API_KEY` | 大模型 API Key | （必填） |
| `MODEL` | 模型名称（需支持多模态图片输入） | `doubao-seed-2-0-mini-260215` |
| `RETRY_MODEL` | 重做测验时使用的模型名称 | `doubao-seed-2-0-lite-260215` |
| `BASE_URL` | OpenAI 兼容的 chat/completions 接口地址 | `https://ark.cn-beijing.volces.com/api/v3/chat/completions` |

### 运行须知

- 脚本以**非无头模式**运行（会看到浏览器操作），启动后可最小化窗口，但**请勿手动操作浏览器**
- 视频播放为 2 倍速静音，播放达到 98.5% 或剩余不足 3 秒即判定完成
- 测验提交后自动检测分数，若未通过则切换更强模型重做；两次 LLM 均未通过时启动暴力遍历，逐题穷举选项组合
- 讨论、考试、作业不会自动完成，需要人工介入
- 模型答题正确率取决于模型本身的识图和理解能力，无法保证 100% 正确
- 大模型 API 调用会产生费用，请关注用量

---

<details>
<summary><b>🆓 免费获取火山引擎 API Key</b></summary>

火山引擎提供**用户协作计划**，参与后可免费使用 doubao 系列模型。加入条件是同意模型产生的数据可被平台采集用于模型改进。

加入入口：<https://console.volcengine.com/ark/region:ark+cn-beijing/openManagement/rewardPlan>

加入后，前往 API Key 管理页面创建密钥即可：<https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey>

</details>

---

## 🐛 已知问题

### 视频记忆缺陷

脚本通过本地文件记录已播放的视频链接。如果某些视频是用户此前在 UOOC 网页上**手动观看**的（而不是通过本程序），这些记录不会出现在本地文件中。重新运行时，脚本可能会**重复播放**这部分视频。不影响最终学习进度，只是多花一些时间。

### 视频内测验前端小 Bug

视频内弹出测验在自动作答后，前端 UI 可能出现轻微显示异常（如选项高亮状态不一致）。这是 AngularJS 数据绑定层面的问题，**仅影响前端显示，不影响答题结果和后端记录**，可忽略。

---

## 📁 项目结构

```
start.js              # 启动入口
config.txt             # 配置文件（账号、API Key、模型等）
package.json
utils/
  config.js            # 配置读取与数据目录管理
  browser.js           # 浏览器启动、反检测、验证码处理
  login.js             # 登录流程 + 并发课程调度
  course.js            # 单课程学习主循环（章节导航）
  video.js             # VideoTracker 类：视频播放、进度记录、去重
  quiz.js              # 测验处理：截图 → 大模型答题 → 提交
  module.js            # 多模态大模型接口（截图识别 + 答题一体化）
  logger.js            # 带颜色的日志输出
data/
  <username>/          # 按用户名隔离的数据目录
    <courseId>.txt      # 已观看视频的 URL 记录
```

如需详细了解实现原理，请移步 [原理.md](原理.md)。

---

## 💬 反馈与讨论

有任何问题欢迎在 [Issue](https://github.com/YusongXiao/fuckuooc/issues) 中讨论。

---

## ⚖️ 免责声明

- 本项目仅用于浏览器自动化、页面流程分析与个人技术研究，请在遵守学校、平台、课程规则及适用法律法规的前提下使用。
- 使用者应自行承担因使用本项目产生的账号、课程、成绩、纪律、合规与费用风险。
- 章节测验的答案正确率由所配置模型的识图和理解能力决定，无法保证正确率、稳定性或可用性。
- 当模型识别失败、页面结构变化、网络异常、验证码策略变化或平台风控升级时，脚本可能失败、卡住或随机选择兜底答案。
- 大模型接口通常按量计费，截图上传与多次重试都会产生额外费用。

## 📄 许可证

本项目采用 MIT License，详见 [LICENSE](LICENSE)。
