function normalizePlate(plateNo) {
  return (plateNo || "").trim().toUpperCase();
}

function getPlateForMonth(plateNo, year, monthIndex, plateLogs) {
  const currentPlate = normalizePlate(plateNo);
  if (!currentPlate || currentPlate === "N/A" || plateLogs.length === 0) {
    return currentPlate;
  }

  // Include the whole linked history in case a vehicle has multiple plate changes.
  const relatedPlates = new Set([currentPlate]);
  let foundRelatedPlate = true;
  while (foundRelatedPlate) {
    foundRelatedPlate = false;
    plateLogs.forEach((log) => {
      const oldPlate = normalizePlate(log.old_plate_no);
      const newPlate = normalizePlate(log.new_plate_no);
      if (relatedPlates.has(oldPlate) || relatedPlates.has(newPlate)) {
        if (oldPlate && !relatedPlates.has(oldPlate)) {
          relatedPlates.add(oldPlate);
          foundRelatedPlate = true;
        }
        if (newPlate && !relatedPlates.has(newPlate)) {
          relatedPlates.add(newPlate);
          foundRelatedPlate = true;
        }
      }
    });
  }

  const relatedLogs = plateLogs
    .filter(
      (log) =>
        relatedPlates.has(normalizePlate(log.old_plate_no)) &&
        relatedPlates.has(normalizePlate(log.new_plate_no)) &&
        log.change_date,
    )
    .sort((a, b) => String(a.change_date).localeCompare(String(b.change_date)));

  if (relatedLogs.length === 0) return currentPlate;

  const month = String(monthIndex + 1).padStart(2, "0");
  const monthStart = `${year}-${month}-01`;
  const monthEnd = new Date(Date.UTC(year, monthIndex + 1, 0))
    .toISOString()
    .slice(0, 10);

  const changesInMonth = relatedLogs.filter(
    (log) => log.change_date >= monthStart && log.change_date <= monthEnd,
  );
  if (changesInMonth.length > 0) {
    const firstChange = changesInMonth[0];
    const lastChange = changesInMonth[changesInMonth.length - 1];
    return `${normalizePlate(firstChange.old_plate_no)} ➔ ${normalizePlate(lastChange.new_plate_no)}`;
  }

  const firstFutureChange = relatedLogs.find(
    (log) => log.change_date > monthEnd,
  );
  if (firstFutureChange) return normalizePlate(firstFutureChange.old_plate_no);

  return normalizePlate(relatedLogs[relatedLogs.length - 1].new_plate_no);
}

module.exports = { getPlateForMonth };
