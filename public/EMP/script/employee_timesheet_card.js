 let isEditMode = false;
        let empDataMap = {};
        let pendingAction = null;

        document.addEventListener('DOMContentLoaded', async () => {
            setDefaultDates();
            if (sessionStorage.getItem('emp_token')) {
                loadDropdown();
            }
        });

        async function loadDropdown() {
            const token = sessionStorage.getItem('emp_token');
            if (!token) return;

            try {
                const res = await fetch('/api/employees', {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (!res.ok) throw new Error("Unauthorized");
                
                const employees = await res.json();
                const select = document.getElementById('empSelect');
                select.innerHTML = '<option value="">Select Employee</option>'; // Clear existing
                
                employees.forEach(emp => {
                    empDataMap[emp.id] = emp;
                    const option = document.createElement('option');
                    option.value = emp.id;
                    option.text = emp.name;
                    select.appendChild(option);
                });
            } catch (e) { 
                console.error("Dropdown load error or token expired"); 
                sessionStorage.removeItem('emp_token');
            }
        }

        function requestAccess(action) {
            if (sessionStorage.getItem('emp_token')) {
                executeAction(action);
            } else {
                pendingAction = action;
                document.getElementById('pinModal').style.display = 'flex';
                document.getElementById('pinInput').value = '';
                document.getElementById('pinInput').focus();
            }
        }

        function closePinModal() {
            document.getElementById('pinModal').style.display = 'none';
        }

        async function verifyPin() {
            const pin = document.getElementById('pinInput').value;
            try {
                const res = await fetch('/api/employees/verify-pin', {
                    method: 'POST', 
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ pin })
                });
                const data = await res.json();
                if (data.success) {
                    sessionStorage.setItem('emp_token', data.token);
                    closePinModal();
                    loadDropdown(); 
                    if(pendingAction) executeAction(pendingAction);
                } else {
                    alert("Incorrect Security Code!");
                    document.getElementById('pinInput').value = '';
                }
            } catch (err) {
                alert("Server error verifying PIN.");
            }
        }

        function executeAction(action) {
            if (action === 'edit') {
                executeToggleEditMode();
            } else if (action === 'add_new') {
                window.location.href = './office_staff_data.html';
            }
        }

        function handleEditClick() {
            if (isEditMode) {
                executeToggleEditMode();
            } else {
                requestAccess('edit');
            }
        }

        function setDefaultDates() {
            const today = new Date();
            let year = today.getFullYear(), month = today.getMonth(), day = today.getDate();
            let startY = year, startM = month, endY = year, endM = month;

            if (day >= 15) {
                endM = month + 1; if (endM > 11) { endM = 0; endY++; }
            } else {
                startM = month - 1; if (startM < 0) { startM = 11; startY--; }
            }
            const fmt = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            document.getElementById('dateFrom').value = fmt(startY, startM, 15);
            document.getElementById('dateTo').value = fmt(endY, endM, 14);
        }

        function executeToggleEditMode() {
            isEditMode = !isEditMode;
            const btn = document.getElementById('editBtn');
            const editables = document.querySelectorAll('.editable');

            if (isEditMode) {
                btn.innerText = "Lock / View Mode";
                btn.classList.add('locked');
                editables.forEach(cell => {
                    cell.setAttribute('contenteditable', 'true');
                    cell.classList.add('active');
                });
            } else {
                btn.innerText = "Enable Edit Mode";
                btn.classList.remove('locked');
                editables.forEach(cell => {
                    cell.setAttribute('contenteditable', 'false');
                    cell.classList.remove('active');
                });
                document.querySelectorAll('#tableBody tr').forEach(row => calculateAndSaveRow(row, false));
            }
        }

        function getDatesInRange(startDate, endDate) {
            const dates = [];
            const date = new Date(startDate);
            while (date <= endDate) {
                dates.push(new Date(date));
                date.setDate(date.getDate() + 1);
            }
            return dates;
        }

        function calcHours(start, end) {
            let s = parseFloat(start), e = parseFloat(end);
            if (isNaN(s) || isNaN(e)) return 0;
            if (e < s) e += 24;
            return e - s;
        }

        function formatVal(val) {
            if (val === 0 || val === '0' || val === '' || val === null || val === undefined) return '';
            let num = parseFloat(val);
            if (isNaN(num)) return val;
            return num === 0 ? '' : (Number.isInteger(num) ? num.toString() : num.toFixed(2));
        }

        async function fetchData() {
            const empId = document.getElementById('empSelect').value;
            if (!empId) return alert("Please select Employee");

            const emp = empDataMap[empId];
            const dateFrom = document.getElementById('dateFrom').value;
            const dateTo = document.getElementById('dateTo').value;
            const token = sessionStorage.getItem('emp_token');

            if (!dateFrom || !dateTo) return alert("Please select both dates.");
            if (!token) return requestAccess(null); 

            document.getElementById('displayName').innerText = emp.name;
            document.getElementById('displayMobile').innerText = `Mob: ${emp.mobile || '-'}`;
            document.getElementById('dispBaseSal').innerText = emp.base_salary;
            document.getElementById('dispShiftHrs').innerText = emp.shift_hours || 10;

            const fmt = { day: '2-digit', month: 'short', year: 'numeric' };
            document.getElementById('displayPeriod').innerText = `${new Date(dateFrom).toLocaleDateString('en-GB', fmt)} - ${new Date(dateTo).toLocaleDateString('en-GB', fmt)}`;

            try {
                const res = await fetch(`/api/employees/logs?empId=${empId}&from=${dateFrom}&to=${dateTo}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (!res.ok) throw new Error("Fetch failed");
                const logs = await res.json();

                const logMap = {};
                logs.forEach(l => { logMap[l.log_date] = l; });

                const tbody = document.getElementById('tableBody');
                tbody.innerHTML = '';

                const dates = getDatesInRange(new Date(dateFrom), new Date(dateTo));
                const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
                const totalDaysInPeriod = dates.length;

                dates.forEach((d, index) => {
                    const dateStrDB = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                    const logDateUI = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
                    const dayNameFull = daysOfWeek[d.getDay()];
                    const dayNameShort = dayNameFull.substring(0, 3);
                    const log = logMap[dateStrDB] || {};

                    const isFriday = dayNameFull === 'Friday';
                    const is31stDay = (totalDaysInPeriod === 31 && index === 30);
                    const isAllOvertime = isFriday || is31stDay;

                    const rowCls = isFriday ? 'class="friday-row"' : '';
                    const editableState = isEditMode ? 'contenteditable="true" class="editable active"' : 'contenteditable="false" class="editable"';

                    tbody.innerHTML += `<tr ${rowCls} data-date="${dateStrDB}" data-day="${dayNameFull}" data-all-ot="${isAllOvertime}">
                        <td style="white-space: nowrap;">${logDateUI}</td>
                        <td>${dayNameShort}</td>
                        <td ${editableState} data-field="shift_start">${formatVal(log.shift_start)}</td>
                        <td ${editableState} data-field="shift_end">${formatVal(log.shift_end)}</td>
                        <td ${editableState} data-field="absent">${log.absent || ''}</td>
                        <td ${editableState} data-field="break_start">${formatVal(log.break_start)}</td>
                        <td ${editableState} data-field="break_end">${formatVal(log.break_end)}</td>
                        <td ${editableState} data-field="remarks">${log.remarks || ''}</td>
                        <td data-calc="break_hr">${formatVal(log.break_hr)}</td>
                        <td data-calc="shift_hr">${formatVal(log.shift_hr)}</td>
                        <td data-calc="worked_hr">${formatVal(log.worked_hr)}</td>
                        <td class="normal-col" data-calc="normal_hr">${formatVal(log.normal_hr)}</td>
                        <td class="ot-col" data-calc="ot_hr">${formatVal(log.ot_hr)}</td>
                    </tr>`;
                });

                attachEditListeners();
                document.querySelectorAll('#tableBody tr').forEach(row => calculateAndSaveRow(row, true));
            } catch (error) { 
                alert('Fetch error. Please verify PIN again.'); 
                sessionStorage.removeItem('emp_token');
            }
        }

        function attachEditListeners() {
            document.querySelectorAll('.editable').forEach(cell => {
                cell.addEventListener('blur', function () {
                    if (isEditMode) calculateAndSaveRow(this.closest('tr'), false);
                });

                cell.addEventListener('keydown', function (e) {
                    if (!isEditMode) return;

                    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
                        e.preventDefault();
                        let currentCell = this;
                        let currentRow = currentCell.closest('tr');
                        let cellIndex = Array.from(currentRow.children).indexOf(currentCell);
                        let targetCell = null;

                        if (e.key === 'ArrowRight') {
                            targetCell = currentCell.nextElementSibling;
                            while (targetCell && !targetCell.classList.contains('editable')) {
                                targetCell = targetCell.nextElementSibling;
                            }
                        } else if (e.key === 'ArrowLeft') {
                            targetCell = currentCell.previousElementSibling;
                            while (targetCell && !targetCell.classList.contains('editable')) {
                                targetCell = targetCell.previousElementSibling;
                            }
                        } else if (e.key === 'ArrowDown') {
                            let nextRow = currentRow.nextElementSibling;
                            if (nextRow) targetCell = nextRow.children[cellIndex];
                        } else if (e.key === 'ArrowUp') {
                            let prevRow = currentRow.previousElementSibling;
                            if (prevRow) targetCell = prevRow.children[cellIndex];
                        }

                        if (targetCell && targetCell.classList.contains('editable')) {
                            targetCell.focus();
                        }
                    } else if (e.key === 'Enter') {
                        e.preventDefault();
                        calculateAndSaveRow(this.closest('tr'), false); 

                        let currentRow = this.closest('tr');
                        let cellIndex = Array.from(currentRow.children).indexOf(this);
                        let nextRow = currentRow.nextElementSibling;
                        if (nextRow && nextRow.children[cellIndex].classList.contains('editable')) {
                            nextRow.children[cellIndex].focus();
                        }
                    }
                });
            });
        }

        async function calculateAndSaveRow(row, isInitialLoad = false) {
            const empId = document.getElementById('empSelect').value;
            const dateStr = row.dataset.date;
            const dayName = row.dataset.day;
            const isAllOvertime = row.dataset.allOt === 'true';
            const empShiftHrPerDay = parseFloat(empDataMap[empId].shift_hours) || 10;

            const getVal = field => row.querySelector(`[data-field="${field}"]`).innerText.trim();
            const setCalc = (field, val) => { row.querySelector(`[data-calc="${field}"]`).innerText = formatVal(val); };

            const sStart = getVal('shift_start');
            const sEnd = getVal('shift_end');
            const bStart = getVal('break_start');
            const bEnd = getVal('break_end');
            const absentRaw = getVal('absent').toLowerCase().trim();

            let isAbsent = false, isIdle = false, isNumericOverride = false, overrideValue = 0;

            if (['ab', 'absent'].includes(absentRaw)) isAbsent = true;
            else if (['id', 'ideal'].includes(absentRaw)) isIdle = true;
            else if (absentRaw !== '' && !isNaN(parseFloat(absentRaw))) {
                isNumericOverride = true;
                overrideValue = parseFloat(absentRaw);
            }

            let breakHr = 0, workedHr = 0, normalHr = 0, otHr = 0, displayWorked = '';

            let shiftHr = isAllOvertime ? 0 : empShiftHrPerDay;

            if (isAbsent) {
                row.querySelector('[data-field="absent"]').innerText = 'AB';
                displayWorked = 'AB'; normalHr = 0; otHr = 0;
            } else if (isIdle) {
                row.querySelector('[data-field="absent"]').innerText = 'ID';
                displayWorked = 'ID'; normalHr = shiftHr; otHr = 0;
            } else if (isNumericOverride) {
                displayWorked = overrideValue;
                if (isAllOvertime) { normalHr = 0; otHr = overrideValue; }
                else {
                    normalHr = Math.min(overrideValue, empShiftHrPerDay);
                    otHr = overrideValue > empShiftHrPerDay ? overrideValue - empShiftHrPerDay : 0;
                }
            } else if (sStart && sEnd) {
                let totalPresence = calcHours(sStart, sEnd);
                if (bStart && bEnd) breakHr = calcHours(bStart, bEnd);

                workedHr = Math.max(0, totalPresence - breakHr);
                displayWorked = workedHr;

                if (isAllOvertime) { normalHr = 0; otHr = workedHr; }
                else {
                    normalHr = Math.min(workedHr, empShiftHrPerDay);
                    otHr = workedHr > empShiftHrPerDay ? workedHr - empShiftHrPerDay : 0;
                }
            } else {
                row.querySelector('[data-field="absent"]').innerText = getVal('absent');
            }

            setCalc('shift_hr', shiftHr);
            setCalc('break_hr', breakHr);
            setCalc('worked_hr', displayWorked);
            setCalc('normal_hr', normalHr);
            setCalc('ot_hr', otHr);

            updateSummary();

            if (isInitialLoad) return;

            const payload = {
                emp_id: empId, log_date: dateStr, day_name: dayName,
                shift_start: sStart ? parseFloat(sStart) : null,
                shift_end: sEnd ? parseFloat(sEnd) : null,
                absent: row.querySelector('[data-field="absent"]').innerText,
                break_start: bStart ? parseFloat(bStart) : null,
                break_end: bEnd ? parseFloat(bEnd) : null,
                remarks: getVal('remarks'),
                break_hr: breakHr, shift_hr: shiftHr,
                worked_hr: String(displayWorked), normal_hr: normalHr, ot_hr: otHr
            };

            const token = sessionStorage.getItem('emp_token');
            if(!token) return;

            document.getElementById('saveIndicator').style.display = 'block';
            try {
                const res = await fetch('/api/employees/logs/save', {
                    method: 'POST', 
                    headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}` 
                    },
                    body: JSON.stringify(payload)
                });
                
                if(!res.ok) throw new Error("Save Failed");
                
                setTimeout(() => document.getElementById('saveIndicator').style.display = 'none', 500);
            } catch (e) {
                document.getElementById('saveIndicator').innerText = 'Save Failed!';
                document.getElementById('saveIndicator').style.background = '#dc3545';
                setTimeout(() => {
                    document.getElementById('saveIndicator').style.display = 'none';
                    document.getElementById('saveIndicator').style.background = '#28a745';
                    document.getElementById('saveIndicator').innerText = 'Saving Data...';
                }, 2000);
            }
        }

        function updateSummary() {
            let totNormal = 0, totOT = 0, daysWrk = 0;
            let totalExpectedNormalHrs = 0;

            document.querySelectorAll('#tableBody tr').forEach(row => {
                const nHr = parseFloat(row.querySelector('[data-calc="normal_hr"]')?.innerText) || 0;
                const oHr = parseFloat(row.querySelector('[data-calc="ot_hr"]')?.innerText) || 0;
                const sHr = parseFloat(row.querySelector('[data-calc="shift_hr"]')?.innerText) || 0;
                const abVal = row.querySelector('[data-field="absent"]')?.innerText.trim().toUpperCase();

                if (nHr > 0 || oHr > 0 || abVal === 'ID' || (!isNaN(parseFloat(abVal)) && parseFloat(abVal) > 0)) {
                    daysWrk++;
                }
                totNormal += nHr;
                totOT += oHr;
                totalExpectedNormalHrs += sHr;
            });

            let actualNormalForDeduction = totNormal;

            if (totNormal > 260) {
                totOT += (totNormal - 260);
                totNormal = 260;
            }

            const empId = document.getElementById('empSelect').value;
            const emp = empDataMap[empId];
            const baseSal = parseFloat(emp.base_salary) || 0;
            const empShiftHrPerDay = parseFloat(emp.shift_hours) || 10;

            const rateHr = baseSal / (empShiftHrPerDay * 26);

            let missingHrs = Math.max(0, totalExpectedNormalHrs - actualNormalForDeduction);
            let deduction = missingHrs * rateHr;
            let baseEarned = Math.max(0, baseSal - deduction);

            let otEarned = totOT * rateHr;
            let totAmt = baseEarned + otEarned;

            document.getElementById('daysWorked').innerText = daysWrk;
            document.getElementById('rateHr').innerText = rateHr.toFixed(2);

            document.getElementById('totalNormal').innerText = Number.isInteger(totNormal) ? totNormal : totNormal.toFixed(2);
            document.getElementById('totalOT').innerText = Number.isInteger(totOT) ? totOT : totOT.toFixed(2);

            document.getElementById('baseEarned').innerText = Number.isInteger(baseEarned) ? baseEarned : baseEarned.toFixed(2);
            document.getElementById('otEarned').innerText = Number.isInteger(otEarned) ? otEarned : otEarned.toFixed(2);
            document.getElementById('totalAmt').innerText = Number.isInteger(totAmt) ? totAmt : totAmt.toFixed(2);
        }

        function exportToPNG() {
            if (isEditMode) executeToggleEditMode(); 
            html2canvas(document.getElementById('printArea'), { scale: 3 }).then(canvas => {
                let link = document.createElement('a');
                link.download = `Log_Report_${document.getElementById('displayName').innerText}.png`;
                link.href = canvas.toDataURL('image/png');
                link.click();
            });
        }