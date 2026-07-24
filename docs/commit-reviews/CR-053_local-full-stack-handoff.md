# CR-053 Local full-stack handoff

## 目标

把 2026-07-24 本地全功能试用的真实状态、启动边界、合成验收和剩余风险写入 README 与交接报告，便于负责人和 GitHub 审核者复核。

## 文档范围

- 更新 README 状态日期和本地全功能试用快照。
- 新增 `LOCAL_FULL_STACK_BRINGUP_REPORT_2026-07-24.md`。
- 不提交 `.env`、密钥、Token、模型权重、上传文件、数据库、运行日志或真实公司数据。

## 已验证组件

- PostgreSQL、Redis、NestJS API、独立 Worker、React/Vite。
- Qwen3-14B-AWQ 文本服务和 PaddleOCR-VL OCR 服务。
- Excel AI 建议、OCR 证据复核与批准入库。
- 实时报告、canonical ReportSnapshot、AI 报告叙述和老板助手。
- 用户、项目、模板、字段、工单、文件和通知等既有 API/页面。

## 明确离线

- Qwen3-VL-8B-Instruct。
- Qwen3-Embedding-8B。
- 所有外部 AI Provider。

这些组件不属于本轮核心链路，保持离线以避免无意义占用显存和扩大数据边界。

## 回滚

文档提交可直接 `git revert <CR-053-sha>`；不会影响数据库或运行服务。
