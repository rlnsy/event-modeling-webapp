const {test}=require('node:test');
const assert=require('node:assert/strict');
const {route,intersects}=require('../routing.js');
const box=(x,y,w=100,h=50)=>({x,y,w,h,cx:x+w/2,cy:y+h/2});
const edge={fromId:'a',toId:'b',kind:'command-event'};
function validate(points,boxes) {
  assert.ok(points && points.length>=2,'route exists');
  for(let i=1;i<points.length;i++) {
    assert.ok(points[i].x===points[i-1].x || points[i].y===points[i-1].y,'orthogonal segments');
    for(const b of Object.values(boxes)) assert.equal(intersects(points[i-1],points[i],b),false,'does not enter a card');
  }
}
test('routes around an intervening card with fixed endpoints',()=>{
  const boxes={a:box(50,20),b:box(50,300),obstacle:box(20,130,160,90)};
  const before=JSON.stringify(boxes), points=route([edge],boxes)[0];
  validate(points,boxes);
  assert.equal(points[0].y,70); assert.equal(points.at(-1).y,300);
  assert.equal(JSON.stringify(boxes),before);
  assert.deepEqual(route([edge],boxes)[0],points,'deterministic');
});
test('fans out through separate source ports and reroutes after card growth',()=>{
  const boxes={a:box(150,20),b:box(20,220),c:box(290,220)};
  const edges=[edge,{...edge,toId:'c'}];
  const paths=route(edges,boxes);
  assert.notEqual(paths[0][0].x,paths[1][0].x);
  paths.forEach(p=>validate(p,boxes));
  boxes.a=box(150,20,100,140);
  route(edges,boxes).forEach(p=>validate(p,boxes));
});
test('cross-slice connectors leave and enter from below',()=>{
  const boxes={a:box(30,200),b:box(250,40),obstacle:box(200,160,180,90)};
  const p=route([{...edge,kind:'cross'}],boxes)[0];
  validate(p,boxes);
  assert.ok(p[1].y>p[0].y); assert.ok(p.at(-2).y>p.at(-1).y);
});
test('overlapping obstacles return an explicit failure',()=>{
  const boxes={a:box(20,20),b:box(20,200),obstacle:box(0,40,150,100)};
  assert.equal(route([edge],boxes)[0],null);
});
test('intersection measurement supports diagonal existing paths and ignores tangencies',()=>{
  const r=box(10,10,10,10);
  assert.equal(intersects({x:0,y:0},{x:30,y:30},r),true);
  assert.equal(intersects({x:0,y:0},{x:30,y:5},r),false);
  assert.equal(intersects({x:0,y:10},{x:30,y:10},r),false);
});

function assertSeparated(paths) {
  paths.forEach((path,i)=>{
    assert.ok(path, 'every connection is present');
    const end=path.at(-1), before=path.at(-2);
    assert.ok(Math.hypot(end.x-before.x,end.y-before.y)>=16, 'arrowhead fits the final straight segment');
    paths.slice(i+1).forEach(other=>{
      for(let a=1;a<path.length;a++) for(let b=1;b<other.length;b++) {
        const p=path[a-1],q=path[a],r=other[b-1],s=other[b];
        const overlapX=Math.max(Math.min(p.x,q.x),Math.min(r.x,s.x))<=Math.min(Math.max(p.x,q.x),Math.max(r.x,s.x));
        const overlapY=Math.max(Math.min(p.y,q.y),Math.min(r.y,s.y))<=Math.min(Math.max(p.y,q.y),Math.max(r.y,s.y));
        assert.equal(overlapX && overlapY,false,'distinct orthogonal lines never touch, cross, or overlap');
      }
    });
  });
}
test('nested fan-in and fan-out reserve separate full-length paths',()=>{
  const boxes={cmd:box(290,30,200,70),rm:box(950,50,200,80)};
  for(let i=0;i<4;i++) boxes['e'+i]=box(30+i*210,250,170,70);
  const edges=Array.from({length:4},(_,i)=>({fromId:'cmd',toId:'e'+i,kind:'command-event'}))
    .concat(Array.from({length:4},(_,i)=>({fromId:'e'+i,toId:'rm',kind:'cross'})));
  const paths=route(edges,boxes);
  paths.forEach(p=>validate(p,boxes));
  assertSeparated(paths);
});
test('infeasible connections are explicit nulls, never overlapping fallback lines',()=>{
  const boxes={a:box(20,20,10,50),b:box(20,200,10,50)};
  const paths=route([edge,edge],boxes);
  assert.ok(paths.some(p=>p===null),'insufficient port clearance is reported');
  assertSeparated(paths.filter(Boolean));
});

test('crowded browser geometry routes all eleven connections with full clearance', () => {
  const { edges, boxes } = require('./fixtures/crowded-geometry.json');
  const paths = route(edges, boxes);
  assert.equal(paths.length, 11);
  assertSeparated(paths);
  paths.forEach((points, index) => {
    validate(points, boxes);
    for (let i = 1; i < points.length; i++) {
      for (const [id, b] of Object.entries(boxes)) {
        // Only the source/destination terminal stubs may enter their own halo.
        if (id === edges[index].fromId || id === edges[index].toId) continue;
        assert.equal(intersects(points[i-1], points[i], {
          x: b.x - 16, y: b.y - 16, w: b.w + 32, h: b.h + 32,
        }), false, '16px clearance around other cards');
      }
      for (const other of paths.slice(index + 1)) for (let j = 1; j < other.length; j++) {
        const a = points[i-1], b = points[i], c = other[j-1], d = other[j];
        const dx = Math.max(0, Math.min(a.x,b.x)-Math.max(c.x,d.x), Math.min(c.x,d.x)-Math.max(a.x,b.x));
        const dy = Math.max(0, Math.min(a.y,b.y)-Math.max(c.y,d.y), Math.min(c.y,d.y)-Math.max(a.y,b.y));
        assert.ok(Math.hypot(dx,dy) >= 7 - 1e-8, '7px clearance between line centers');
      }
    }
  });
});
