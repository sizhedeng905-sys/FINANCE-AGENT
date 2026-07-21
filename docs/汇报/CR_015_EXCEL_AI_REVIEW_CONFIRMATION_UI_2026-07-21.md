# CR-015 Excel AI 确认页审核证据报告

日期：2026-07-21

分支：`agent/b8-stable-hardening`

状态：`LOCAL_ENGINEERING_VERIFIED / REMOTE_PUSH_BLOCKED_EXTERNAL`

## 目标

把 CR-014 已由服务端核验并持久化的 Excel AI 人工审核决定展示给第二财务。确认页只读取审计事实，不重新解释模型输出，也不让 AI 取得批准权或写库能力。

## 实现

- 新增确认页只读证据区，分页调用 `GET /api/import-tasks/:id/ai-review-decisions`。
- 每条证据展示来源列、AI 建议字段、参考置信度、财务决定、最终字段、审核人和时间。
- 展开项展示人工理由、review revision、冻结模板版本、转换键、evidence refs、AI Task、输出哈希和版本向量哈希；长 ID 可复制且默认压缩显示。
- 请求键绑定任务、当前用户和分页参数，并以 epoch 丢弃任务切换、登出或翻页后的晚到响应。
- 证据加载中或加载失败时禁用最终批准；服务正常返回空集合的纯人工任务仍可继续原审批流程。
- 390px 视口下等待侧栏响应式过渡稳定后检查文档宽度；表格只在自身滚动容器内横向滚动，不扩大页面。

## E2E 事实链

1. 财务 `finance` 上传带公式缓存的独立合成 Excel，解析后请求真实 AI 建议。
2. 批量采纳只进入草稿，保存时由 CR-014 服务端验证并持久化审核决定。
3. 确认页真实读取审核决定；API 返回的 AI Task、输出哈希、版本向量、决定和操作者与保存来源一致。
4. 批准前按任务查询正式经营记录为 0。
5. 退出后由中文账号 `财务` 进入同一确认页，能够看到同一服务端证据并完成确定性重新校验。
6. 证据接口被注入 503 后，页面显示明确错误且“批准并入库”保持禁用；正式经营记录仍为 0。

## 测试证据

| 门禁 | 结果 |
| --- | --- |
| CR-015 单场景 | 1/1 PASS，含 390px 稳定布局和证据 503 失败关闭 |
| Excel AI 专项 | 3/3 PASS，26.7 秒；清理 3 个任务、1 个 Profile、4 个 AI Task、3 个文件引用，磁盘残留 0 |
| 完整 Playwright | 21/21 PASS，约 1.2 分钟；含四角色、工单闭环、Excel、OCR、报告和安全边界 |
| E2E 完整清理 | 1 工单、8 ImportTask、1 OCR、6 BusinessRecord、5 Profile、4 AI Task、3 Snapshot、9 文件引用；磁盘残留 0 |
| 前端 production build | 3,149 modules，PASS |
| CR-014 远端 Build | SHA `5580ce3`，run `29834746500`，两个 job PASS |
| CR-014 远端 CodeQL | SHA `5580ce3`，run `29834746264`，PASS |

## 边界与剩余风险

- 本提交展示的是数据库中的已验证审核决定，不证明真实模型准确率，也不把 `confidence` 当批准依据。
- 人工映射在模型不可用时仍可保存；若确认页自身无法读取审计证据，则审批失败关闭，避免在证据状态未知时继续写库。
- 最终批准仍由既有后端在事务内重新鉴权、核对验证快照、版本和幂等键；本组件不能提交 reviewer、role、目标状态或 BusinessRecord。
- 三次人工演练仍为 `NOT_RUN`；真实财务/OCR/AI 真值、目标 Linux Staging 和 owner UAT 仍未关闭。
- 本地提交 `2a59509` 连续三次无法连接 `github.com:443`，状态为外部网络阻断；网络恢复后正常推送并以新 SHA 取得 Build/CodeQL，PR 保持 Draft。
