# 物流企业 AI 财务运营审核系统

当前项目是前端 UI 原型，不包含后端、数据库和真实 AI API 调用。所有数据来自 `src/mock`，未来接口统一预留在 `src/api`。

## 技术栈

- React + TypeScript + Vite
- Ant Design
- Zustand
- React Router
- ECharts

## 启动

```bash
npm install
npm run dev
```

浏览器访问：

```text
http://localhost:5173
```

## 登录账号

统一密码：

```text
123456
```

账号：

```text
employee
finance
reviewer
boss
```

## 角色入口

- `employee` -> `/employee/home`
- `finance` -> `/finance/home`
- `reviewer` -> `/reviewer/home`
- `boss` -> `/boss/home`

## 后端接入位置

- 登录接口：`src/api/authApi.ts`
- 工单接口：`src/api/workOrderApi.ts`
- AI 对话接口：`src/api/aiApi.ts`，预留 `POST /api/ai/chat`
- 报表接口：`src/api/reportApi.ts`

真实接口接入后，优先替换 `api` 目录内的 Promise mock 返回，页面和 Zustand store 可以保持现有调用方式。
