// build_demo.js — parte 1/4: cabecera y CSS
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, '..', 'public', 'demo.html');

const CSS = `:root{--a:#f97316;--dk:#1e293b;--g:#16a34a;--b:#0ea5e9;--r:#dc2626;--y:#f59e0b;--bg:#f1f5f9;--w:#fff;--bd:#e2e8f0;--tx:#0f172a;--mu:#64748b;--ra:12px;--sh:0 4px 16px rgba(15,23,42,.10)}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Segoe UI',sans-serif;background:var(--bg);color:var(--tx);font-size:14px}
#splash{position:fixed;inset:0;background:linear-gradient(135deg,#1e293b,#0f172a);display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:9999;transition:opacity .6s}
.sp-logo{font-size:64px;color:var(--a);margin-bottom:16px}
.sp-h1{color:#fff;font-size:32px;font-weight:800}
.sp-p{color:#94a3b8;margin-top:8px;font-size:16px}
.bar-wrap{margin-top:32px;width:260px;height:6px;background:#334155;border-radius:99px;overflow:hidden}
.bar{height:100%;background:var(--a);border-radius:99px;width:0;transition:width .4s}
.sp-st{color:#94a3b8;font-size:13px;margin-top:12px;min-height:20px}
#shell{display:none;flex-direction:column;height:100vh}
header{background:linear-gradient(135deg,#1e293b,#0f172a);color:#fff;display:flex;align-items:center;justify-content:space-between;padding:0 24px;height:58px;flex-shrink:0}
.brand{display:flex;align-items:center;gap:10px;font-weight:700;font-size:18px}
.brand i{color:var(--a);font-size:22px}
.tgln{font-size:12px;color:#94a3b8;font-weight:400}
.hdr-r{display:flex;align-items:center;gap:12px}
.live{background:var(--g);color:#fff;font-size:11px;font-weight:700;padding:3px 10px;border-radius:99px;display:flex;align-items:center;gap:5px}
.live::before{content:'';width:7px;height:7px;background:#fff;border-radius:50%;animation:pulse 1.4s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.btn-h{background:var(--a);color:#fff;border:none;padding:7px 16px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer}
.btn-h:hover{background:#ea580c}
.nav{background:var(--w);border-bottom:2px solid var(--bd);display:flex;overflow-x:auto;flex-shrink:0;scrollbar-width:none}
.nav::-webkit-scrollbar{display:none}
.tab{padding:13px 18px;cursor:pointer;font-size:13px;font-weight:600;color:var(--mu);white-space:nowrap;display:flex;align-items:center;gap:7px;border-bottom:3px solid transparent;margin-bottom:-2px;transition:color .2s,border-color .2s}
.tab:hover{color:var(--dk)}.tab.active{color:var(--a);border-bottom-color:var(--a)}
.body{flex:1;overflow-y:auto;padding:24px}
.sec{display:none}.sec.active{display:block}
.card{background:var(--w);border-radius:var(--ra);box-shadow:var(--sh);margin-bottom:20px;overflow:hidden}
.ch{padding:16px 20px;border-bottom:1px solid var(--bd);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px}
.ct{font-weight:700;font-size:15px;display:flex;align-items:center;gap:8px}.ct i{color:var(--a)}
.cb{padding:20px}
.g2{display:grid;grid-template-columns:1fr 1fr;gap:20px}
.kpi-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:20px}
.kpi{background:var(--w);border-radius:var(--ra);box-shadow:var(--sh);padding:20px;display:flex;align-items:center;gap:16px}
.ki{width:48px;height:48px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0}
.io{background:#fff7ed;color:var(--a)}.ig{background:#f0fdf4;color:var(--g)}.ib{background:#f0f9ff;color:var(--b)}.iy{background:#fffbeb;color:var(--y)}
.kv{font-size:24px;font-weight:800;line-height:1}.kl{font-size:12px;color:var(--mu);margin-top:3px}
.tbl{width:100%;border-collapse:collapse}
.tbl th{text-align:left;padding:10px 14px;font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:var(--mu);background:#f8fafc;border-bottom:1px solid var(--bd)}
.tbl td{padding:11px 14px;border-bottom:1px solid #f1f5f9;font-size:13px;vertical-align:middle}
.tbl tr:last-child td{border-bottom:none}.tbl tr:hover td{background:#f8fafc}
.bdg{display:inline-flex;align-items:center;gap:4px;padding:3px 9px;border-radius:99px;font-size:11px;font-weight:700}
.bg{background:#dcfce7;color:#15803d}.bo{background:#fff7ed;color:#c2410c}.bb{background:#e0f2fe;color:#0369a1}
.by{background:#fffbeb;color:#b45309}.br{background:#fee2e2;color:#b91c1c}.bgr{background:#f1f5f9;color:#475569}`;

module.exports = { CSS };
