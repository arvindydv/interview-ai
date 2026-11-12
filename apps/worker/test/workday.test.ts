import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workdayAge, workdayIndiaFacet } from '../src/listings/boards.js';

test('Workday posting ages are read in days, unknown ones last', () => {
  assert.deepEqual(
    ['Posted Today', 'Posted Yesterday', 'Posted 3 Days Ago', 'Posted 30+ Days Ago', undefined].map(workdayAge),
    [0, 1, 3, 30, 31],
  );
});

test('a Workday country facet named India is used as is', () => {
  const facets = [
    { facetParameter: 'jobFamilyGroup', values: [{ descriptor: 'Engineering', id: 'e', count: 40 }] },
    {
      facetParameter: 'locationMainGroup',
      values: [
        { facetParameter: 'locationCountry', values: [{ descriptor: 'India', id: 'in', count: 245 }, { descriptor: 'Taiwan', id: 'tw', count: 90 }] },
        { facetParameter: 'locations', values: [{ descriptor: 'India, Bengaluru', id: 'blr', count: 199 }] },
      ],
    },
  ];
  assert.deepEqual(workdayIndiaFacet(facets), { locationCountry: ['in'] });
});

test('without a country facet, every India site in the busiest facet; Indiana is not India', () => {
  const facets = [
    {
      facetParameter: 'locations',
      values: [
        { descriptor: 'India - Hyderabad', id: 'hyd', count: 120 },
        { descriptor: 'Pune, India', id: 'pune', count: 30 },
        { descriptor: 'Indiana - Indianapolis', id: 'ind', count: 50 },
        { descriptor: 'Remote India', id: 'rem', count: 0 },
      ],
    },
  ];
  assert.deepEqual(workdayIndiaFacet(facets), { locations: ['hyd', 'pune'] });
});

test('a site with no India jobs is read whole', () => {
  assert.equal(workdayIndiaFacet([{ facetParameter: 'locations', values: [{ descriptor: 'Indiana', id: 'x', count: 3 }] }]), null);
  assert.equal(workdayIndiaFacet([]), null);
});
