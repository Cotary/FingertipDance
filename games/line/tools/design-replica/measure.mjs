import fs from 'node:fs';
const pwPath = process.env.PLAYWRIGHT_PATH
  || 'file:///C:/Users/Tupss/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';
const { chromium } = await import(pwPath);
const id = process.argv[2] || 'mingsha__tile.pale';
const A = fs.readFileSync(`I:/work/f-game/docs/连连看/复刻SOP/scripts/baseline/${id}.png`).toString('base64');
const C = fs.readFileSync(`I:/work/f-game/games/line/shots/${id}.png`).toString('base64');
const browser = await chromium.launch();
const p = await browser.newPage();
await p.setContent('<html></html>');
const r = await p.evaluate(async ([a, c]) => {
  const load = (s) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = 'data:image/png;base64,' + s; });
  const scan = (img, am) => {
    const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
    const x = cv.getContext('2d'); x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, cv.width, cv.height).data;
    let minX=1e9,minY=1e9,maxX=-1,maxY=-1;
    for (let y=0;y<cv.height;y++) for (let px=0;px<cv.width;px++){
      const k=(y*cv.width+px)*4;
      if(d[k+3]>am){if(px<minX)minX=px;if(px>maxX)maxX=px;if(y<minY)minY=y;if(y>maxY)maxY=y;}
    }
    return {minX,minY,maxX,maxY,w:maxX-minX+1,h:maxY-minY+1};
  };
  const [ia, ic] = await Promise.all([load(a), load(c)]);
  return { canvas:[ia.width, ic.width], design_solid: scan(ia,250), ours_solid: scan(ic,250) };
}, [A, C]);
console.log(id); console.log(JSON.stringify(r, null, 1));
await browser.close();
