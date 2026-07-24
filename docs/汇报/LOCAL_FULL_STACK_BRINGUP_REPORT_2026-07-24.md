# FINANCE-AGENT 本地全功能试用交接报告

日期：2026-07-24

分支：`agent/local-full-stack-bringup`

起始检查点：`b744325890ff2ed1373723646d9ccd7639033824`

## 1. 结论

FINANCE-AGENT 已在本机隔离环境完成全功能技术试用。数据库名称以 `_test` 结尾，全部应用和模型端口只绑定 `127.0.0.1`，外部 AI Provider 关闭，第一轮只使用 seed、合成数据和仓库 fixture。

本结论表示“本地工程闭环可浏览、可复现”，不表示真实 OCR/AI 准确率通过、目标 Staging 通过或 production-ready。

## 2. 运行组件

| 组件 | 本地地址/状态 |
| --- | --- |
| PostgreSQL | `127.0.0.1:5432`，隔离库 `finance_agent_pilot_test` |
| Redis | `127.0.0.1:6379` |
| NestJS API | `http://127.0.0.1:3101/api` |
| Readiness | `http://127.0.0.1:3101/api/health/ready` |
| Swagger | `http://127.0.0.1:3101/api/docs` |
| 独立 Worker | 常驻后台进程 |
| React/Vite | `http://127.0.0.1:4173` |
| Qwen3-14B-AWQ | `127.0.0.1:8000`，本地 OpenAI-compatible |
| PaddleOCR-VL | `127.0.0.1:8868`，本地 OCR adapter |
| Qwen3-VL-8B-Instruct | 离线，非本轮核心链路 |
| Qwen3-Embedding-8B | 离线，非本轮核心链路 |

## 3. 本地合成业务证据

- OCR 链路：识别、AI 建议、人工纠错、另一财务批准，生成金额 `1280.50` 的正式记录。
- Excel 链路：Qwen 分类与字段映射、人工审核、另一财务批准，生成金额 `8765.43` 的正式记录。
- 当前合成正式记录：2 条，总成本 `10045.93`。
- ReportSnapshot：2 个正式来源，固定查询和 Decimal 聚合为 `10045.93`。
- 报告叙述：`report_narrative:v5`，11 个 claims 均通过服务端 grounding，经财务和老板两级接受。
- 老板助手：本地 Qwen 只复述固定工具返回的支出 `10045.93` 和记录数 `2`，没有使用 fallback。
- 上传者自审批保持 403；重复批准返回同一幂等结果，不重复生成正式记录。

## 4. 自动化验收

| 门禁 | 结果 |
| --- | --- |
| Paddle adapter | 9/9 passed |
| 后端单元 | 52 suites，479/479 passed |
| PostgreSQL/Redis | 125 total，111 passed，14 skipped，0 failed |
| 前端 runtime | 4/4 passed |
| Playwright API 模式 | 22/22 passed |
| 后端 build | passed |
| 前端 production build | passed |
| Prisma | format/validate/generate passed，test 库 52 migrations |
| Git whitespace | `git diff --check` passed |

49,999 行场景在完整集成 suite 中约 172.883 秒，低于 180 秒断言但余量有限。新增复合索引解决累计执行时的重复扫描；目标环境仍需独立容量验收。

## 5. 数据和安全边界

- 不连接生产数据库。
- 不读取、上传或处理真实公司文件。
- 不调用外部 AI Provider。
- 不向公网暴露端口。
- 不在文档和 Git 中保存数据库密码、JWT、模型 API key、Token、Cookie 或预签名 URL。
- Qwen-VL 和 Embedding 保持离线。
- 模型只生成建议；财务批准前不创建正式记录。
- 报告数字只来自 canonical ReportSnapshot，AI 不查库、不算账。

## 6. 负责人体验入口

打开 `http://127.0.0.1:4173`，使用 seed 演示账号登录。浏览器里残留的旧 JWT 在服务重启后可能失效，出现 401 时退出并重新登录即可。

建议体验顺序：

1. 财务账号查看项目、模板、字段和数据记录。
2. 进入 Excel 导入，查看 AI 字段建议和人工复核证据。
3. 进入 OCR 任务，查看原图/PDF bbox、人工纠错和批准链。
4. 查看经营日报及展开的 ReportSnapshot 数据依据。
5. 切换老板账号，查看只读数据、最终审批和 AI 助手。

## 7. 尚未关闭

- 真实公司样本 OCR/AI 盲测与字段真值。
- 正式财务口径逐分对账和负责人 UAT 签字。
- 目标 Linux Staging、正式 secret、备份恢复和 RPO/RTO。
- 生产 migration 窗口及大表索引锁评估。
- 外部 Provider 数据政策与授权。

以上事项继续失败关闭，不能由本地合成绿色结果替代。
