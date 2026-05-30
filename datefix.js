const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function convertExcelDate(val) {
  if (val && val instanceof Date) {
    const istOffset = 5.5 * 60 * 60 * 1000;
    const corrected = new Date(val.getTime() + istOffset);
    return `${String(corrected.getUTCDate()).padStart(2,'0')}-${months[corrected.getUTCMonth()]}-${corrected.getUTCFullYear()}`;
  }
  return null;
}

const testDate = new Date('2024-09-14T18:30:00.000Z');
console.log('Input:', testDate.toISOString());
console.log('Output:', convertExcelDate(testDate));
console.log('Expected: 15-Sep-2024');
