/* Obstacle-aware orthogonal routing with hard card and connector clearance. */
(function (root) {
  "use strict";
  const PAD = 16;
  const GAP = 7;
  const inflate = b => ({ x: b.x - PAD, y: b.y - PAD, w: b.w + PAD * 2, h: b.h + PAD * 2 });
  function intersects(a, b, r) {
    if (a.x === b.x) return a.x > r.x && a.x < r.x + r.w &&
      Math.max(a.y, b.y) > r.y && Math.min(a.y, b.y) < r.y + r.h;
    if (a.y === b.y) return a.y > r.y && a.y < r.y + r.h &&
      Math.max(a.x, b.x) > r.x && Math.min(a.x, b.x) < r.x + r.w;
    // Open rectangle intersection for diagonal baseline connectors.
    let lo=0, hi=1;
    for (const [v,d,min,max] of [[a.x,b.x-a.x,r.x,r.x+r.w],[a.y,b.y-a.y,r.y,r.y+r.h]]) {
      const t1=(min-v)/d, t2=(max-v)/d;
      lo=Math.max(lo,Math.min(t1,t2)); hi=Math.min(hi,Math.max(t1,t2));
    }
    return lo < hi;
  }
  const clear = (a, b, boxes) => !boxes.some(r => intersects(a, b, r));
  function simplify(points) {
    const out = [];
    for (const p of points) {
      if (out.length && out.at(-1).x === p.x && out.at(-1).y === p.y) continue;
      while (out.length > 1) {
        const a = out.at(-2), b = out.at(-1);
        if (!((a.x === b.x && b.x === p.x && (b.y-a.y)*(p.y-b.y) >= 0) ||
          (a.y === b.y && b.y === p.y && (b.x-a.x)*(p.x-b.x) >= 0))) break;
        out.pop();
      }
      out.push(p);
    }
    return out;
  }
  // Rectilinear visibility grid, with a bend penalty. Nodes never move.
  // Bound the grid to keep pathological models from exhausting a routing worker.
  function avoid(start, end, obstacles) {
    const xs = [...new Set([start.x, end.x, ...obstacles.flatMap(r => [r.x, r.x+r.w])])].sort((a,b)=>a-b);
    const ys = [...new Set([start.y, end.y, ...obstacles.flatMap(r => [r.y, r.y+r.h])])].sort((a,b)=>a-b);
    if (xs.length * ys.length > 24000) return null;
    const point = i => ({x: xs[i % xs.length], y: ys[Math.floor(i / xs.length)]});
    const index = p => ys.indexOf(p.y) * xs.length + xs.indexOf(p.x);
    const src = index(start), dst = index(end), queue = [];
    const distances = new Map(), previous = new Map();
    const heuristic = i => { const p=point(i); return Math.abs(p.x-end.x)+Math.abs(p.y-end.y); };
    const push = entry => {
      queue.push(entry); let i=queue.length-1;
      while(i>0) { const p=(i-1)>>1; if(queue[p].f<=entry.f) break; queue[i]=queue[p]; i=p; }
      queue[i]=entry;
    };
    const pop = () => {
      const first=queue[0], last=queue.pop();
      if(queue.length) { let i=0; queue[0]=last;
        while(2*i+1<queue.length) { let c=2*i+1;
          if(c+1<queue.length && queue[c+1].f<queue[c].f) c++;
          if(queue[c].f>=last.f) break; queue[i]=queue[c]; i=c;
        } queue[i]=last;
      } return first;
    };
    distances.set(src*3,0); push({key:src*3, cost:0, f:heuristic(src)});
    while(queue.length) {
      const current=pop();
      if(current.cost!==distances.get(current.key)) continue;
      const i=Math.floor(current.key/3), dir=current.key%3;
      if(i===dst) {
        const path=[]; let key=current.key;
        while(key!==undefined) { path.push(point(Math.floor(key/3))); key=previous.get(key); }
        return simplify(path.reverse());
      }
      const x=i%xs.length, y=Math.floor(i/xs.length), a=point(i);
      for(const [nx,ny,nextDir] of [[x-1,y,1],[x+1,y,1],[x,y-1,2],[x,y+1,2]]) {
        if(nx<0 || ny<0 || nx>=xs.length || ny>=ys.length) continue;
        const j=ny*xs.length+nx, b=point(j);
        if(!clear(a,b,obstacles)) continue;
        const cost=current.cost+Math.abs(a.x-b.x)+Math.abs(a.y-b.y)+(dir && dir!==nextDir ? 24 : 0);
        const key=j*3+nextDir;
        if(cost >= (distances.get(key) ?? Infinity)) continue;
        distances.set(key,cost); previous.set(key,current.key); push({key,cost,f:cost+heuristic(j)});
      }
    }
    return null;
  }
  function corridor(a, b) {
    return {x:Math.min(a.x,b.x)-GAP,y:Math.min(a.y,b.y)-GAP,
      w:Math.abs(a.x-b.x)+GAP*2,h:Math.abs(a.y-b.y)+GAP*2};
  }
  function conflicts(a, b) {
    if (!a || !b) return false;
    return a.some((p,i)=>i && b.some((q,j)=>j && intersects(a[i-1],p,corridor(b[j-1],q))));
  }
  function route(edges, boxes) {
    const obstacles=Object.values(boxes).map(inflate), ports=new Map();
    const sides=edges.map(e => {
      const a=boxes[e.fromId], b=boxes[e.toId];
      const down=b && a && b.cy>=a.cy;
      return e.kind==='cross' ? [1,1] : [down?1:-1,down?-1:1];
    });
    edges.forEach((e,i) => [e.fromId,e.toId].forEach((id,k) => {
      const key=JSON.stringify([id,sides[i][k]]);
      if(!ports.has(key)) ports.set(key,[]);
      ports.get(key).push([i,k]);
    }));
    // Order fan-out ports spatially; reverse a U-turn's destination ports so
    // nested connections can reach them without weaving across one another.
    for (const group of ports.values()) group.sort(([i,k],[j,l]) => {
      const a=boxes[k ? edges[i].fromId : edges[i].toId];
      const b=boxes[l ? edges[j].fromId : edges[j].toId];
      const reverse=k===1 && edges[i].kind==='cross' && edges[j].kind==='cross';
      return ((a?.cx??0)-(b?.cx??0))*(reverse?-1:1) || i-j;
    });
    const port=(id,i,k) => {
      const b=boxes[id], side=sides[i][k], group=ports.get(JSON.stringify([id,side]));
      const n=group.findIndex(v=>v[0]===i && v[1]===k);
      return {x:b.x+b.w*(n+1)/(group.length+1),y:side===1?b.y+b.h:b.y};
    };
    const terminals=edges.map((e,i)=>{
      if(!boxes[e.fromId]||!boxes[e.toId]) return null;
      const p=port(e.fromId,i,0),q=port(e.toId,i,1);
      return [p,{x:p.x,y:p.y+sides[i][0]*PAD},{x:q.x,y:q.y+sides[i][1]*PAD},q];
    });
    const distance=i=>{
      const a=boxes[edges[i].fromId],b=boxes[edges[i].toId];
      return a&&b ? Math.abs(a.cx-b.cx)+Math.abs(a.cy-b.cy) : Infinity;
    };
    const indices=edges.map((_,i)=>i);
    const shortFirst=[...indices].sort((a,b)=>distance(a)-distance(b)||a-b);
    const orders=[shortFirst,[...shortFirst].reverse(),indices];
    for(let offset=1;offset<Math.min(indices.length,12);offset++)
      orders.push([...shortFirst.slice(offset),...shortFirst.slice(0,offset)]);
    let best=edges.map(()=>null), bestCount=0;
    for(const order of orders) {
      const reserved=[], result=edges.map(()=>null);
      for(const i of order) {
        const e=edges[i],a=boxes[e.fromId],b=boxes[e.toId]; if(!a||!b) continue;
        const p=port(e.fromId,i,0),q=port(e.toId,i,1);
        const start={x:p.x,y:p.y+sides[i][0]*PAD},end={x:q.x,y:q.y+sides[i][1]*PAD};
        const other=Object.entries(boxes).filter(([id])=>String(id)!==String(e.fromId) && String(id)!==String(e.toId)).map(([,r])=>inflate(r));
        if(!clear(p,start,[...other,...reserved])||!clear(end,q,[...other,...reserved])) continue;
        const futurePorts=terminals.flatMap((ends,j)=>j===i||!ends?[]:[corridor(ends[0],ends[1]),corridor(ends[2],ends[3])]);
        const middle=avoid(start,end,[...obstacles,...reserved,...futurePorts]);
        if(!middle) continue;
        const points=simplify([p,...middle,q]);
        // Reserve the whole polyline, including arrow approach and source stub.
        // Subsequent routes cannot cross, touch, or share these corridors.
        if(result.some(existing=>conflicts(points,existing))) continue;
        result[i]=points;
        points.forEach((v,j)=>{if(j) reserved.push(corridor(points[j-1],v));});
      }
      const count=result.filter(Boolean).length;
      if(count>bestCount) {best=result;bestCount=count;}
      if(count===edges.length) break;
    }
    return best;
  }
  const api={route,intersects,conflicts};
  if(typeof module!=="undefined" && module.exports) module.exports=api;
  else root.ConnectorRouting=api;
})(globalThis);
