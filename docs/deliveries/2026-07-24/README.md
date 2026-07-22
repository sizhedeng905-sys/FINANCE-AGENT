# 2026-07-24 周五演示交付包

本目录用于在一台已经安装 Node.js 24、PostgreSQL 和项目依赖的本地开发机上，重复演示“Excel 上传 -> 确定性解析/映射 -> 不同财务复核批准 -> 正式经营记录 -> 老板经营日报与审计快照”。主故事只使用合成 Excel、真实 NestJS API、真实本地 PostgreSQL 和固定后端报表查询，不依赖 GitHub、外网、本地大模型或 OCR 冷启动。

## 交付内容

- [现场演示步骤](DEMO_RUNBOOK.md)：开场前准备和 5-8 分钟逐步讲解。
- [验收记录](ACCEPTANCE.md)：人工真值、自动化证据、批准前后差异及三次演练表。
- [能力限制](LIMITATIONS.md)：OCR、AI、报表口径、目标服务器和生产就绪边界。
- [后续 2-4 周计划](NEXT_WAVE.md)：按可验证结果组织的下一轮工作。
- [CR-011 自动化故事线](../../commit-reviews/CR-011_friday-excel-report-demo-e2e.md)：真实 API E2E 的技术证据。

## 这次交付是什么

- 一条可以离线重建、验证和自动回归的合成业务故事线。
- 一份把页面操作、角色切换、人工真值和预期结果固定下来的演示 Runbook。
- 一组只允许本机 `finance_agent_test` 数据库的安全命令。
- 对批准前隔离、职责分离、逐分金额、幂等入账和 ReportSnapshot 来源哈希的工程证明。

## 这次交付不是什么

- 不是 production 部署包、正式上线批准或目标服务器验收。
- 不是对真实公司 Excel、真实 OCR 或本地模型准确率的证明。
- 不是 AI 自动审批、自动入账或 AI 自行计算财务金额。
- 不是正式财务口径签字、恢复演练、容量承诺或独立安全审计。

## 快速入口

首次准备：

```powershell
Copy-Item backend/.env.test.example backend/.env.test
npm ci
npm ci --prefix backend
npm run demo:config:test
npm run demo:reset
npm run demo:verify
```

`backend/.env.test` 必须使用本机 PostgreSQL、数据库名必须精确为 `finance_agent_test`，并设置至少 32 字符的测试 JWT secret。真实环境文件和密码不会进入 Git。

启动两个终端：

```powershell
# 终端 1
npm run demo:api

# 终端 2
npm run demo:web
```

浏览器打开 `http://127.0.0.1:4173`。纯自动化复验使用 `npm run demo:test`；该命令会先重新初始化隔离测试数据，再运行周五故事线并清理测试产物。

## 当前判定

自动化故事线、本机启动 smoke 和 SHA `66749b3` 的远端 Build/CodeQL 已有证据；三次连续人工现场演练仍为 `NOT_RUN`。因此本交付包当前是 `REMOTE_ENGINEERING_VERIFIED / CONDITIONAL_NO_GO`，不能写成正式演示 GO 或 production-ready。
