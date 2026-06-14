@echo off
rem Dev launcher — ensures Node is on PATH (needed by tools that spawn with a stale environment).
set "PATH=C:\Program Files\nodejs;%PATH%"
npm run dev
