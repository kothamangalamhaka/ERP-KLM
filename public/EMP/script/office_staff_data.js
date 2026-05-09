
        document.addEventListener('DOMContentLoaded', () => {
            if (sessionStorage.getItem('emp_token')) {
                unlockPage();
            } else {
                document.getElementById('entryPin').focus();
            }
        });

        async function verifyEntryPin() {
            const pin = document.getElementById('entryPin').value;
            try {
                const res = await fetch('/api/employees/verify-pin', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ pin })
                });
                const data = await res.json();
                if (data.success) {
                    sessionStorage.setItem('emp_token', data.token);
                    unlockPage();
                } else {
                    showToast("Incorrect Security Code!", false);
                    document.getElementById('entryPin').value = '';
                }
            } catch (err) {
                showToast("Server Error. Check connection.", false);
            }
        }

        function unlockPage() {
            document.getElementById('pageBlocker').style.display = 'none';
            document.getElementById('mainContent').style.display = 'block';
            loadEmployees();
        }

        function goBackToReport() {
            window.location.href = './Employee_Timesheet_Card.html';
        }

        async function loadEmployees() {
            const token = sessionStorage.getItem('emp_token');
            if (!token) return;

            try {
                const response = await fetch('/api/employees', {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (!response.ok) throw new Error("Unauthorized");

                const employees = await response.json();
                const tableBody = document.getElementById('employeeTableBody');
                tableBody.innerHTML = '';

                employees.forEach(emp => {
                    const statusColor = emp.status === 'Active' ? 'green' : 'red';
                    const row = `<tr>
                        <td>${emp.name}</td>
                        <td>${emp.mobile || '-'}</td>
                        <td>${emp.base_salary || 0}</td>
                        <td>${emp.shift_hours || 0}</td>
                        <td style="color: ${statusColor}; font-weight: bold;">${emp.status || 'Active'}</td>
                        <td>
                            <button class="action-btn" onclick="editEmployee('${emp.id}', '${emp.name}', '${emp.mobile || ''}', '${emp.base_salary}', '${emp.shift_hours}', '${emp.start_date || ''}', '${emp.end_date || ''}')">Edit</button>
                        </td>
                    </tr>`;
                    tableBody.innerHTML += row;
                });
            } catch (error) {
                console.error('Error loading employees:', error);
                sessionStorage.removeItem('emp_token');
                window.location.reload();
            }
        }

        function openModal() {
            document.getElementById('modalTitle').innerText = "Register New Employee";
            document.getElementById('empId').value = "";
            document.getElementById('empName').value = "";
            document.getElementById('empMobile').value = "";
            document.getElementById('baseSalary').value = "20000";
            document.getElementById('shiftHrs').value = "10";
            document.getElementById('startDate').value = "";
            document.getElementById('endDate').value = "";
            document.getElementById('regModal').style.display = "block";
        }

        function closeModal() { document.getElementById('regModal').style.display = "none"; }

        function editEmployee(id, name, mobile, baseSal, shiftHrs, start, end) {
            document.getElementById('modalTitle').innerText = "Edit Employee";
            document.getElementById('empId').value = id;
            document.getElementById('empName').value = name;
            document.getElementById('empMobile').value = mobile;
            document.getElementById('baseSalary').value = baseSal;
            document.getElementById('shiftHrs').value = shiftHrs;
            document.getElementById('startDate').value = start;
            document.getElementById('endDate').value = end;
            document.getElementById('regModal').style.display = "block";
        }

        function showToast(message, isSuccess = true) {
            const toast = document.getElementById("toastMessage");
            toast.innerText = message;
            toast.className = isSuccess ? "toast show success" : "toast show error";

            if (document.getElementById('pageBlocker').style.display !== 'none') {
                toast.style.zIndex = '10000';
            }

            setTimeout(() => { toast.className = toast.className.replace("show", ""); }, 3000);
        }

        async function saveEmployee() {
            const id = document.getElementById('empId').value;
            const data = {
                name: document.getElementById('empName').value,
                mobile: document.getElementById('empMobile').value,
                base_salary: parseFloat(document.getElementById('baseSalary').value) || 0,
                shift_hours: parseFloat(document.getElementById('shiftHrs').value) || 0,
                start: document.getElementById('startDate').value,
                end: document.getElementById('endDate').value
            };

            if (!data.name) return showToast("Name is required!", false);

            const method = id ? 'PUT' : 'POST';
            const url = id ? `/api/employees/${id}` : '/api/employees/new';
            const token = sessionStorage.getItem('emp_token');

            try {
                const res = await fetch(url, {
                    method: method,
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify(data)
                });
                if (res.ok) {
                    showToast("Employee Data Saved!");
                    closeModal();
                    loadEmployees();
                } else { showToast("Failed to save data.", false); }
            } catch (error) { showToast("Server Error", false); }
        }
