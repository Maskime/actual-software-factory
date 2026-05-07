<template>
  <div class="h-screen w-screen overflow-hidden">
    <NuxtPage />
  </div>
</template>

<style>
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Manrope:wght@300;400;500&display=swap');

:root {
  --bg:        #f4f4f5;
  --surface:   #ffffff;
  --elevated:  #f4f4f5;
  --border:    #e4e4e7;
  --border-2:  #d4d4d8;
  --hi:        #334155;
  --hdr-txt:   #f8fafc;
  --user-txt:  #f1f5f9;
  --txt:       #3f3f46;
  --txt-2:     #71717a;
  --txt-3:     #a1a1aa;
  --err:       #dc2626;
  --mono:      'IBM Plex Mono', monospace;
  --sans:      'Manrope', system-ui, sans-serif;
}

*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: var(--bg); }
</style>
