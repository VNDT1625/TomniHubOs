import { describe, expect, it } from 'vitest';
import {
  bindingForDestinations,
  bindingForPersonalSet,
  destinationsOfBinding,
  parseSecretDestinations,
} from '@process/resources/sessionSecrets/destinations';

describe('bindingForDestinations', () => {
  it('maps a web form to the browser route with exact hostnames', () => {
    expect(bindingForDestinations(['browser'], ['Admin.Example.com'])).toEqual({
      surfaces: ['browser', 'owner'],
      purposes: ['browser-fill', 'reveal'],
      targets: ['admin.example.com'],
    });
  });

  it('maps a terminal to its own surface and purpose', () => {
    expect(bindingForDestinations(['terminal'])).toEqual({
      surfaces: ['terminal', 'owner'],
      purposes: ['terminal-input', 'reveal'],
    });
  });

  it('maps managed processes and deployments to the secret firewall', () => {
    expect(bindingForDestinations(['process'])).toEqual({
      surfaces: ['secret-firewall', 'owner'],
      purposes: ['opaque-use', 'reveal'],
    });
  });

  it('combines several destinations without duplicates', () => {
    const binding = bindingForDestinations(['browser', 'terminal', 'process', 'terminal'], ['a.example.com']);
    expect(binding.surfaces).toEqual(['browser', 'terminal', 'secret-firewall', 'owner']);
    expect(binding.purposes).toEqual(['browser-fill', 'terminal-input', 'opaque-use', 'reveal']);
    expect(binding.targets).toEqual(['a.example.com']);
  });

  it('refuses a web form without a hostname and a set without any destination', () => {
    expect(() => bindingForDestinations(['browser'])).toThrow(/hostname/iu);
    expect(() => bindingForDestinations(['browser'], ['https://example.com/login'])).toThrow(/hostname/iu);
    expect(() => bindingForDestinations([])).toThrow(/destination/iu);
  });
});

describe('destinationsOfBinding', () => {
  it('reads back what a binding allows, hiding the owner route', () => {
    const binding = bindingForDestinations(['browser', 'process'], ['a.example.com']);
    expect(destinationsOfBinding(binding)).toEqual({ destinations: ['browser', 'process'], hosts: ['a.example.com'] });
  });

  it('reports no destination for an internal credential', () => {
    expect(destinationsOfBinding({ surfaces: ['telegram'], purposes: ['telegram-bot'] })).toEqual({ destinations: [] });
  });

  it('treats the legacy Settings binding (web plus firewall) as browser and process', () => {
    expect(
      destinationsOfBinding({
        surfaces: ['browser', 'secret-firewall'],
        purposes: ['browser-fill', 'opaque-use'],
        targets: ['x.example.com'],
      })
    ).toEqual({ destinations: ['browser', 'process'], hosts: ['x.example.com'] });
  });
});

describe('bindingForPersonalSet (Settings, Cá nhân)', () => {
  it('keeps the legacy web-plus-firewall binding when no destination is chosen', () => {
    expect(bindingForPersonalSet(undefined, ['Admin.Example.com'])).toEqual({
      surfaces: ['browser', 'secret-firewall'],
      purposes: ['browser-fill', 'opaque-use'],
      targets: ['admin.example.com'],
    });
    expect(() => bindingForPersonalSet(undefined, [])).toThrow(/hostname/iu);
  });

  it('lets a set be terminal-only without any hostname', () => {
    expect(bindingForPersonalSet(['terminal'], [])).toEqual({
      surfaces: ['terminal', 'owner'],
      purposes: ['terminal-input', 'reveal'],
    });
  });

  it('still demands exact hostnames when a web form is chosen', () => {
    expect(() => bindingForPersonalSet(['browser', 'terminal'], [])).toThrow(/hostname/iu);
    expect(bindingForPersonalSet(['browser', 'terminal'], ['a.example.com']).targets).toEqual(['a.example.com']);
  });
});

describe('parseSecretDestinations', () => {
  it('accepts a list of known destinations and leaves an absent value absent', () => {
    expect(parseSecretDestinations(undefined)).toBeUndefined();
    expect(parseSecretDestinations(['terminal', 'process'])).toEqual(['terminal', 'process']);
  });

  it('rejects anything else', () => {
    for (const value of ['terminal', [], ['email'], [1], null, {}]) {
      expect(() => parseSecretDestinations(value)).toThrow(/destination/iu);
    }
  });
});
