const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
ctx.fillStyle = '#141824';
ctx.fillRect(0, 0, canvas.width, canvas.height);
console.log('target:', __TARGET__, 'api:', __API_BASE__);
