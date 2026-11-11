import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

//fake browser.* APIs (storage) for the unit tests
export default defineConfig({
  plugins: [WxtVitest()],
});
