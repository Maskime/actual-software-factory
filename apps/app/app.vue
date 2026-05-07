<template>
  <div class="h-screen w-screen overflow-hidden">
    <NuxtPage />
  </div>
</template>

<style>
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Manrope:wght@300;400;500&display=swap');

:root {
  --bg:        #0b1629;
  --surface:   #102040;
  --elevated:  #162d58;
  --border:    #1e3870;
  --border-2:  #284d96;
  --hi:        #4d9eff;
  --accent:    #00c2ff;
  --hdr-txt:   #e0ebff;
  --user-txt:  #dce8ff;
  --txt:       #b8cef0;
  --txt-2:     #6882b8;
  --txt-3:     #364e80;
  --err:       #ff5555;
  --mono:      'IBM Plex Mono', monospace;
  --sans:      'Manrope', system-ui, sans-serif;
}

*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: var(--bg); }
</style>
