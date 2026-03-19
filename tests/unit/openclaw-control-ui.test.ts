import { describe, expect, it } from 'vitest';

import { buildOpenClawControlUiUrl } from '@electron/utils/openclaw-control-ui';

describe('buildOpenClawControlUiUrl', () => {
  it('uses the URL fragment for one-time token bootstrap', () => {
    expect(buildOpenClawControlUiUrl(18789, 'shortclaw-test-token')).toBe(
      'http://127.0.0.1:18789/#token=shortclaw-test-token',
    );
  });

  it('omits the fragment when the token is blank', () => {
    expect(buildOpenClawControlUiUrl(18789, '   ')).toBe('http://127.0.0.1:18789/');
  });
});
