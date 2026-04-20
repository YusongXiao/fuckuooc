# fuckuooc

一键自动完成 [UOOC 联盟](https://www.uooc.net.cn/) 课程学习，当前版本支持：

- 自动登录
- 自动看视频
- 自动完成视频内弹题
- 自动完成章节测验 / 课程测验
- 自动识别并填写填空题、问答题、论述题
- 独立窗口自动处理评论与作业

运行后可最小化窗口，脚本会继续自动执行。

## ✅ Features

- **自动登录并通过人机验证** - 模拟真人鼠标轨迹，自动完成阿里云验证码
- **自动扫描待学习课程** - 登录后自动收集当前账号下可处理课程
- **多课程并发学习** - 学习窗口默认可并发处理多门课
- **自动完成视频内弹题** - 视频中途弹出的小测自动穷举组合并提交
- **自动完成章节测验 / 课程测验** - 单题截图 → 大模型识图 / 文本识别 → 自动提交
- **支持填空题 / 问答题 / 论述题** - 修复旧版本“识别到答案但未填入就提交”的问题
- **评论 / 作业独立任务窗口** - 与刷课主流程分离，按课程顺序检查 `/result`、`/homework` 和讨论区
- **讨论自动补足** - 在同一门课的不同讨论区、不同帖子中复制已有评论进行回复，并带全局冷却

## 🎥 演示

**自动登录：**

<img src="https://oss.songhappy.cn/fuckuooc/auto_login.gif" width="720" alt="自动登录演示">

**登录后自动并行刷课：**

<img src="https://oss.songhappy.cn/fuckuooc/auto_three_class.gif" width="720" alt="多课程并行演示">

**自动完成视频内弹题：**

<img src="https://oss.songhappy.cn/fuckuooc/auto_in_video_test.gif" width="720" alt="视频内测验演示">

**自动完成章节测验：**

<img src="https://oss.songhappy.cn/fuckuooc/auto_test.gif" width="720" alt="章节测验演示">

## 🚀 快速开始

> **环境要求**：Node.js >= 18

### 1. 克隆项目

```bash
git clone https://github.com/YusongXiao/fuckuooc
cd fuckuooc
```

### 2. 安装依赖

```bash
npm install
```

### 3. 编辑配置

打开根目录下的 `config.txt`，至少填写：

```ini
# UOOC
USERNAME=你的手机号
PASSWORD=你的密码

# LLM
API_KEY=你的 API Key
```

其余配置项有默认值，一般不需要改。

### 4. 运行

```bash
node start.js
```

启动后只会询问两个开关：

```text
是否自动学习视频/测验 (Y/n):
是否评论/作业 (Y/n):
```

说明：

- 第一项控制**学习窗口**
- 第二项控制**评论 / 作业独立窗口**

如果第二项选择 `Y`，脚本会额外打开一个独立标签页，按课程顺序：

1. 查看 `/result`
2. 检查作业进度
3. 进入 `/homework` 处理未提交作业
4. 检查讨论得分是否未满
5. 进入讨论区补评论

---

## 📌 支持范围

| 类型 | 支持情况 | 说明 |
|---|---|---|
| 视频播放 | ✅ 支持 | 自动进入老界面学习页、定位未看视频、倍速静音播放 |
| 视频内弹题 | ✅ 支持 | 穷举选项组合自动提交 |
| 章节测验 / 课程测验 | ✅ 支持 | 单题截图后调用大模型识别并自动提交 |
| 填空题 / 问答题 / 论述题 | ✅ 支持 | 题目截图后让模型返回文本答案并自动填入 |
| 评论 | ✅ 支持 | 独立任务窗口跨不同讨论区、不同帖子补评论 |
| 作业 | ✅ 支持 | 独立任务窗口自动查找未提交作业并按截止时间顺序处理 |
| 考试 | ❌ 不支持 | 当前版本不纳入自动化范围 |

---

## ⚠️ 注意事项

### 模型要求与限制

脚本要求模型具备以下能力：

1. **支持图片输入 / 多模态理解**
2. **兼容 OpenAI Chat Completions 接口格式**
3. **能稳定返回 JSON**

理论上支持任意 OpenAI 兼容接口地址。若使用其它平台，请确保：

- 支持图片输入
- 兼容 `chat/completions`
- 不会频繁拒绝 JSON 输出

### 配置参考

`config.txt` 支持以下字段：

| 字段 | 说明 | 默认值 |
|---|---|---|
| `USERNAME` | UOOC 登录账号 | 必填 |
| `PASSWORD` | UOOC 登录密码 | 必填 |
| `API_KEY` | 大模型 API Key | 必填 |
| `MODEL` | 主模型 | `doubao-seed-2-0-mini-260215` |
| `RETRY_MODEL` | 测验重试模型 | `doubao-seed-2-0-lite-260215` |
| `BASE_URL` | OpenAI 兼容接口地址 | `https://ark.cn-beijing.volces.com/api/v3/chat/completions` |
| `HEADLESS` | 是否无头模式 | `false` |
| `SLOW_MO` | 浏览器慢动作毫秒 | `100` |
| `COURSE_CONCURRENCY` | 学习窗口课程并发数 | `3` |
| `MAX_COURSES` | 最多处理课程数，`0` 为全部 | `0` |
| `DISCUSSION_INTERVAL_MS` | 评论冷却时间 | `65000` |
| `DISCUSSION_MAX_POSTS` | 每轮每课最多评论条数 | `3` |
| `DISCUSSION_SCAN_PAGES` | 评论扫描页数 | `1` |
| `DISCUSSION_MAX_ROUNDS` | 每门课评论补足最大轮次 | `5` |
| `HOMEWORK_MAX_TASKS` | 每门课最多处理作业数，`0` 为全部 | `0` |
| `ENABLE_CONSOLE_MENU` | 是否显示启动提问 | `true` |

### 运行须知

- 当前学习流程**固定走老界面**：`/home/learn/index#/课程ID/go`
- 评论 / 作业与主刷课流程**分离**
- 评论窗口当前优先级为：**先作业，后评论**
- 未提交作业会按**最早截止时间优先**
- 评论不是在同一帖子里反复刷，而是在**不同评论区 / 不同帖子**中补评论
- 评论内容当前策略为：**复制当前帖子中已有的别人评论**
- 大模型请求会产生费用，请自行关注额度与账单

---

<details>
<summary><b>🆓 免费获取火山引擎 API Key</b></summary>

可前往火山方舟控制台申请并创建 API Key：

- API Key 管理：
  <https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey>

</details>

---

## 🧩 已知问题

### 视频记录边界问题

脚本通过本地文件记录已播放视频 URL。若某些视频是你此前手动看过、但不是通过本程序看的，那么这些记录不会出现在本地文件里，重新运行时可能会重复播放少量视频。

### 视频内弹题前端显示问题

部分视频内弹题在自动作答后，前端高亮状态可能不完全同步。这通常只是 AngularJS 视图层显示问题，不影响后端答题结果。

### 讨论项精确“还差几条”无法直接获取

平台成绩接口会返回：

- `discuss_score`
- `discuz`
- `discuss_cnt`
- `discuss_reply_cnt`

但不会直接返回“还差多少条讨论”。当前脚本按**讨论得分是否达到该项权重**来判断是否继续补评论。

---

## 🧱 项目结构

```text
start.js               # 启动入口
config.txt             # 配置文件
package.json
utils/
  browser.js           # 浏览器启动、反检测、验证码处理
  cli.js               # 启动时两个开关
  config.js            # 配置读取
  course.js            # 学习窗口主循环
  discussion.js        # 评论处理
  login.js             # 登录与总调度
  logger.js            # 彩色日志
  module.js            # 大模型调用
  quiz.js              # 测验处理
  task.js              # 作业处理
  task_worker.js       # 评论/作业独立窗口
  video.js             # 视频播放与进度记录
data/
  <username>/
    <courseId>.txt
    discussion_<courseId>.json
debug/
```

如需了解更详细的实现逻辑，请看 [原理.md](原理.md)。

---

## 💬 反馈与讨论

如有问题欢迎提 Issue 或继续在本地调试。

---

## 📄 许可证

MIT License
