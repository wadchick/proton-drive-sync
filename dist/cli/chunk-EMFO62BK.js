#!/usr/bin/env node
import { createRequire as __pdsCreateRequire } from "node:module"; const require = __pdsCreateRequire(import.meta.url);
import"./chunk-YR54R7RT.js";import{createInterface as m}from"node:readline";function f(o,t=!1,s={input:process.stdin,output:process.stderr}){return new Promise((u,p)=>{let{input:a,output:n}=s,r=m({input:a,output:n,terminal:!0});if(t){let e=r,c=e._writeToOutput.bind(r),i=!1;e._writeToOutput=l=>{i||(c(l),i=!0)}}r.question(o,e=>{r.close(),t&&n.write(`
`),u(t?e:e.trim())}),r.once("error",p)})}function w(o){return f(`${o} [y/N] `).then(t=>/^y(es)?$/i.test(t))}export{w as confirm,f as prompt};
