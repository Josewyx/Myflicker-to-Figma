"""Render generic instruction diagrams; contains no user screenshots or device data.
Requires Python playwright and its Chromium browser (development only).
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
import html
root=Path(__file__).resolve().parents[1]
steps=[('01-install','从 GitHub 市场安装','设置 → Plugins → 插件市场','添加 Josewyx/Myflicker-to-Figma','找到插件 → 安装并启用'),('02-import-menu','在 Figma 首次导入','打开一个设计文件','Plugins → Development','Import plugin from manifest…'),('03-select-manifest','选择本机配套文件','文件窗口左侧 → 下载','Myflicker-to-Figma（本机专用）','选中 manifest.json → 打开'),('04-connected','连接成功后开始使用','运行 Myflicker-to-Figma','确认绿色“已连接”状态','可以收起窗口；关闭会断开连接')]
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True)
 page=browser.new_page(viewport={'width':1100,'height':520},device_scale_factor=1)
 for number,(name,title,*items) in enumerate(steps,1):
  cards=''.join(f'<div class="step"><b>{i}</b><span>{html.escape(text)}</span></div>' for i,text in enumerate(items,1))
  page.set_content('<meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#f5f3ed;color:#24312f;font-family:"PingFang SC",sans-serif;padding:48px}.label{font-size:14px;letter-spacing:2px;color:#63716c}h1{font-size:32px;margin:20px 0 32px}.step{display:flex;gap:20px;align-items:center;padding:18px 24px;background:white;border:1px solid #dfe3d9;border-radius:12px;margin:12px 0;font-size:21px}b{border-radius:50%;background:#eaf0e7;color:#205d49;width:34px;height:34px;text-align:center;line-height:34px;font-size:17px}.foot{color:#69776d;font-size:14px;margin-top:22px}</style><div class="label">Myflicker-to-Figma · 操作示意 '+str(number)+'/4</div><h1>'+html.escape(title)+'</h1>'+cards+'<div class="foot">通用操作示意 · 实际按钮与界面可能随应用更新变化</div>')
  page.screenshot(path=str(root/'mf/guide-images'/f'{name}.png'))
 browser.close()
