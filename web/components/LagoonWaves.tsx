'use client';
// Full-viewport lagoon background. Shader adapted from React Bits "Gradient Waves" (https://reactbits.dev/backgrounds/gradient-waves),
// ported to raw WebGL2 (no ogl) with slope lighting added: the stock shader colours by height only, so waves blur together on a
// light palette. Tuned to the "Calm" preset. Colours come from --wave-* CSS tokens and follow the light/dark theme.
import { useEffect, useRef } from 'react';

const VERT = `#version 300 es
in vec2 position; void main(){ gl_Position = vec4(position, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
uniform vec2 iResolution; uniform float iTime; uniform vec2 uMouse;
uniform vec3 uHorizonColor; uniform vec3 uWaveColor; uniform vec3 uCrestColor;
out vec4 fragColor;
const float uSpeed=0.25, uAmplitude=2.5, uWaveScale=0.6, uWaveRatio=0.9, uSwell=35.0, uTurbulence=20.0, uTilt=1.11, uZoom=1.0,
  uHeight=5.5, uFogDepth=38.0, uSteps=70.0, uParallax=0.3, uShade=0.8, uSpec=0.12, MAX_DIST=20000.0;
float hash21(vec2 p){ vec3 p3=fract(vec3(p.xyx)*0.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float plasma(vec3 r, vec2 freq, vec4 tc){
  float mx=r.x+tc.x; mx+=uSwell*sin((r.y+mx)/20.0+tc.y);
  float my=r.y-tc.z; my+=uTurbulence*cos(r.x/23.0+tc.w);
  return r.z-(sin(mx*freq.x)*uAmplitude+sin(my*freq.y)*uAmplitude+uHeight);
}
float raymarch(vec3 pos, vec3 dir, vec2 freq, vec4 tc){
  float dist=0.0;
  for(int i=0;i<128;i++){ if(float(i)>=uSteps) break; float d=plasma(pos+dist*dir,freq,tc); if(abs(d)<0.1) break; dist+=0.9*d; if(!(abs(dist)<MAX_DIST)) return MAX_DIST; }
  return dist;
}
void main(){
  float T=iTime*uSpeed; vec2 freq=vec2(uWaveScale/7.0,(uWaveScale*uWaveRatio)/3.0);
  vec4 tc=vec4(T/0.130,T/0.810,T/0.200,T/0.710); float c,s;
  float vfov=(3.14159/2.3)/max(uZoom,0.05); vec3 cam=vec3(0.0,0.0,30.0);
  vec2 uv=(gl_FragCoord.xy/iResolution.xy)-0.5; uv.x*=iResolution.x/iResolution.y; uv.y*=-1.0;
  vec3 dir=vec3(0.0,0.0,-1.0); float ulen=length(uv); float xrot=vfov*ulen;
  c=cos(xrot); s=sin(xrot); dir=mat3(1.0,0.0,0.0,0.0,c,-s,0.0,s,c)*dir;
  vec2 nuv=ulen>1e-5?uv/ulen:vec2(1.0,0.0); c=nuv.x; s=nuv.y; dir=mat3(c,-s,0.0,s,c,0.0,0.0,0.0,1.0)*dir;
  c=cos(uTilt); s=sin(uTilt); dir=mat3(c,0.0,s,0.0,1.0,0.0,-s,0.0,c)*dir;
  float yaw=(uMouse.x-0.5)*uParallax*0.4, pitch=(uMouse.y-0.5)*uParallax*0.4;
  c=cos(yaw); s=sin(yaw); dir=mat3(c,0.0,s,0.0,1.0,0.0,-s,0.0,c)*dir;
  c=cos(pitch); s=sin(pitch); dir=mat3(1.0,0.0,0.0,0.0,c,-s,0.0,s,c)*dir;
  float dist=raymarch(cam,dir,freq,tc); vec3 pos=cam+dist*dir;
  float t=clamp(uFogDepth/max(dist,0.001),0.0,1.0);
  vec3 body=mix(uWaveColor,uCrestColor,clamp(pos.z*0.08+0.5,0.0,1.0));
  float e=0.6;
  vec3 n=normalize(vec3(plasma(pos+vec3(e,0,0),freq,tc)-plasma(pos-vec3(e,0,0),freq,tc),
                        plasma(pos+vec3(0,e,0),freq,tc)-plasma(pos-vec3(0,e,0),freq,tc), 2.0*e));
  vec3 L=normalize(vec3(0.35,0.55,0.75));
  body*=mix(1.0,0.5+0.5*clamp(dot(n,L),0.0,1.0),uShade);
  body+=vec3(pow(clamp(dot(n,normalize(L-dir)),0.0,1.0),24.0)*uSpec);
  vec3 col=clamp(mix(uHorizonColor,body,t),0.0,1.0);
  float alpha=clamp(t+(hash21(gl_FragCoord.xy+mod(iTime,64.0)*11.0)-0.5)*0.04,0.0,1.0);
  fragColor=vec4(col*alpha,alpha);
}`;

const hexRgb = (hex: string) => {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex.trim());
  return m ? [1, 2, 3].map((i) => parseInt(m[i]!, 16) / 255) : [1, 1, 1];
};

/** `still`: one frozen frame (app pages); redrawn only on resize or theme change. */
export function LagoonWaves({ className, still = false }: { className?: string; still?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const gl = canvas?.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false });
    // No WebGL2 (or a lost context): the page background (--wave-horizon) shows instead.
    if (!canvas || !gl || gl.isContextLost()) return;

    const shader = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src); gl.compileShader(s);
      return s;
    };
    const prog = gl.createProgram()!;
    const vs = shader(gl.VERTEX_SHADER, VERT), fs = shader(gl.FRAGMENT_SHADER, FRAG);
    const buf = gl.createBuffer();
    const release = () => { gl.deleteProgram(prog); gl.deleteShader(vs); gl.deleteShader(fs); gl.deleteBuffer(buf); };
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.warn('LagoonWaves:', gl.getProgramInfoLog(prog)); release(); return; }
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const pos = gl.getAttribLocation(prog, 'position');
    gl.enableVertexAttribArray(pos); gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
    const u = (n: string) => gl.getUniformLocation(prog, n);
    const uRes = u('iResolution'), uTime = u('iTime'), uMouse = u('uMouse');

    const reduce = still || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const t0 = performance.now();
    const mouse = [0.5, 0.5], target = [0.5, 0.5];
    const draw = () => {
      mouse[0] += 0.05 * (target[0]! - mouse[0]!); mouse[1] += 0.05 * (target[1]! - mouse[1]!);
      gl.uniform1f(uTime, still ? 8 : (performance.now() - t0) / 1000); // t = 8 s: a calm, well-shaped swell
      gl.uniform2f(uMouse, mouse[0]!, mouse[1]!);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const setColors = () => {
      const cs = getComputedStyle(document.documentElement);
      gl.uniform3fv(u('uHorizonColor'), hexRgb(cs.getPropertyValue('--wave-horizon')));
      gl.uniform3fv(u('uWaveColor'), hexRgb(cs.getPropertyValue('--wave-body')));
      gl.uniform3fv(u('uCrestColor'), hexRgb(cs.getPropertyValue('--wave-crest')));
      if (reduce) draw();
    };
    const resize = () => {
      const scale = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(canvas.clientWidth * scale));
      canvas.height = Math.max(1, Math.floor(canvas.clientHeight * scale));
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      if (reduce) draw();
    };

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    const themeObs = new MutationObserver(setColors); // the theme toggle flips a class on <html>
    themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    const onMove = (e: PointerEvent) => { target[0] = e.clientX / window.innerWidth; target[1] = 1 - e.clientY / window.innerHeight; };
    if (!reduce) window.addEventListener('pointermove', onMove);

    let raf = 0;
    const loop = () => { draw(); raf = requestAnimationFrame(loop); };
    const onVisibility = () => {
      if (document.hidden) { cancelAnimationFrame(raf); raf = 0; } else if (!reduce && !raf) raf = requestAnimationFrame(loop);
    };
    document.addEventListener('visibilitychange', onVisibility);

    setColors(); resize();
    if (!reduce) raf = requestAnimationFrame(loop); // reduced motion: one still frame, redrawn only on resize/theme change

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect(); themeObs.disconnect();
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('visibilitychange', onVisibility);
      release(); // not loseContext(): StrictMode remounts on the same canvas and would get a dead context
    };
  }, [still]);

  return <canvas ref={ref} aria-hidden className={className} style={{ display: 'block', width: '100%', height: '100%' }} />;
}
