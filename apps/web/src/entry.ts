import { readViewParams } from './scene/share';

// Page entry: the customer link (`?view=present`) loads only the read-only presenter; everything
// else loads the editor (main.ts). Separate chunks, so customers never download editing code.
if (readViewParams(location.search).readOnly) void import('./present/customer');
else void import('./main');
