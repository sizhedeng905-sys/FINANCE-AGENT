# 常用命令

## 安装依赖

```bash
npm install
```

## 启动开发环境

```bash
npm run dev
```

常用访问地址：

```text
http://localhost:5173
http://127.0.0.1:5173
```

## 打包生产版本

```bash
npm run build
```

构建结果会生成到：

```text
dist/
```

## 预览生产包

```bash
npm run preview
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

## 检查本机端口

```powershell
Get-NetTCPConnection -LocalPort 5173 -State Listen
```

## 手动指定端口启动

```powershell
npm run dev -- --host 127.0.0.1 --port 5173
```
