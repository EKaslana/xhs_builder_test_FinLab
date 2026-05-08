# 金融实证分析工作台 FinLab

面向金融专业本科生的可交互实证论文数据分析网页 — 从数据导入到结果导出全流程一站式完成。

## ✨ 功能模块

1. **① 数据导入** — Excel/CSV 上传 + 智能并表（自动识别面板/静态表，方案预览后执行）
2. **② 数据清洗** — 缺失值处理、缩尾、过滤、变量映射调整
3. **③ 描述统计** — 描述性统计、相关性矩阵、可标准化
4. **④ 假设检验** — Wald 检验等
5. **⑤ 基准回归** — OLS / 固定效应 / 聚类标准误
6. **⑥ 机制分析** — 中介效应、调节效应等
7. **⑦ 实证模板** — 控制变量公式库（19 个）+ 样本筛选规则（7 条）+ 研究设计模板（基准面板/DID/中介/调节/事件研究）+ 一键缩尾
8. **⑧ 结果导出**

每个模块均带「学一学」抽屉，提供 *是什么 / 为什么 / 怎么读* 三栏教学。

## 🛠 技术栈

- **前端**：React + Vite + TypeScript + Tailwind CSS + shadcn/ui，wouter 哈希路由
- **后端**：FastAPI（Python，端口 8765）+ Express（Node，端口 5000，作为静态服务和反代）
- **数据**：pandas / numpy / linearmodels / statsmodels / openpyxl

## 🚀 本地运行

```bash
# 1. 安装依赖
npm install
cd python_backend && pip install -r requirements.txt && cd ..

# 2. 开发模式
npm run dev

# 3. 生产构建
npm run build
NODE_ENV=production node dist/index.cjs
```

打开 http://localhost:5000 即可。

## 📁 项目结构

```
finlab/
├── client/src/
│   ├── pages/          # 8 个主页面（数据导入、清洗、描述、检验、回归、机制、模板、导出）
│   ├── components/     # 共用组件（teach 教学抽屉、auto-merge、var-picker 等）
│   └── lib/            # store、api、queryClient
├── python_backend/
│   ├── main.py         # FastAPI 路由
│   ├── auto_panel.py   # 智能并表引擎
│   ├── templates.py    # 实证模板库（变量公式 + 筛选规则 + 研究设计）
│   └── ...
└── server/             # Express 入口（启动 Python 子进程并代理 /api/py/*）
```

## 📚 模板库内容

- **19 个控制变量公式**：Size、Lev、ROA、ROE、TobinQ、BM、Top1、Indep、Dual、Board、SOE、Big4、Cash、Fixed、Loss、Cashflow、Growth、ListAge、Size_rev
- **7 条样本筛选规则**：剔除金融业、剔除 ST、剔除 Lev 异常、剔除上市前数据、剔除已退市、缩尾 1%/99%、剔除主要变量缺失
- **5 套研究设计**：基准面板回归、DID、中介效应、调节效应、事件研究

## 📝 License

MIT
