// 1. ตั้งค่า Firebase (นำ Config จากโปรเจกต์คุณมาใส่)
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT.firebaseapp.com",
    projectId: "YOUR_PROJECT",
    storageBucket: "YOUR_PROJECT.appspot.com",
    messagingSenderId: "YOUR_MSG_ID",
    appId: "YOUR_APP_ID"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();

const app = {
    currentUser: null,
    userRole: 'guest', // 'borrower', 'staff', 'admin'
    dynamicFields: [],

    init: function() {
        auth.onAuthStateChanged((user) => {
            if (user) {
                this.checkUserRole(user);
            } else {
                this.currentUser = null;
                this.userRole = 'guest';
                document.getElementById('mainNavbar').style.display = 'none';
                this.switchView('view-login');
            }
        });
    },

    switchView: function(viewId) {
        document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
        document.getElementById(viewId).classList.add('active');
    },

    // ---------------- AUTHENTICATION ----------------
    loginWithGoogle: function() {
        const provider = new firebase.auth.GoogleAuthProvider();
        auth.signInWithPopup(provider).then((result) => {
            const user = result.user;
            // เช็คว่ามีข้อมูลในระบบหรือยัง
            db.collection('users').doc(user.uid).get().then(doc => {
                if (!doc.exists) {
                    this.switchView('view-borrower-info');
                    document.getElementById('mainNavbar').style.display = 'block';
                    document.getElementById('userDisplayName').innerText = user.displayName;
                }
            });
        }).catch(err => Swal.fire('เกิดข้อผิดพลาด', err.message, 'error'));
    },

    staffLogin: function() {
        const user = document.getElementById('staffUsername').value;
        const pass = document.getElementById('staffPassword').value;

        // Super Admin Default
        if (user === 'sxaiq54' && pass === 'elis542800') {
            this.userRole = 'admin';
            this.currentUser = { uid: 'admin_master', name: 'ผู้ดูแลระบบสูงสุด', role: 'admin' };
            this.onStaffLoginSuccess();
            return;
        }

        // ตรวจสอบจากฐานข้อมูล Staff
        db.collection('staffs').where('username', '==', user).where('password', '==', pass).get().then(snap => {
            if (snap.empty) {
                Swal.fire('ล้มเหลว', 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง', 'error');
            } else {
                const staffData = snap.docs[0].data();
                if (staffData.isLocked) {
                    Swal.fire('ถูกระงับ', 'บัญชีถูกล็อกโดยผู้ดูแลระบบ กรุณาติดต่อผู้ดูแลระบบ', 'error');
                    return;
                }
                this.userRole = staffData.role || 'staff';
                this.currentUser = { uid: snap.docs[0].id, ...staffData };
                
                // แจ้งเตือนการเข้าสู่ระบบไปที่อีเมล (เรียกผ่าน Cloud Functions หรือจำลองการส่งข้อมูล)
                this.logIPAndSendEmail(staffData.email);
                
                this.onStaffLoginSuccess();
            }
        });
    },

    onStaffLoginSuccess: function() {
        document.getElementById('mainNavbar').style.display = 'block';
        document.getElementById('userDisplayName').innerText = `[${this.userRole.toUpperCase()}] ${this.currentUser.name}`;
        this.switchView('view-staff-dashboard');
        this.loadStaffDashboard();
    },

    checkUserRole: function(user) {
        // เช็คว่าผู้ใช้เป็นใคร
        db.collection('users').doc(user.uid).get().then(doc => {
            document.getElementById('mainNavbar').style.display = 'block';
            document.getElementById('userDisplayName').innerText = user.displayName;
            this.currentUser = user;
            this.userRole = 'borrower';
            
            if (doc.exists && doc.data().isLocked) {
                Swal.fire('ถูกระงับ', 'บัญชีถูกล็อกโดยผู้ดูแลระบบ', 'error');
                auth.signOut();
                return;
            }
            
            if (doc.exists && doc.data().profileComplete) {
                this.switchView('view-borrower-dashboard');
                this.loadAvailableLoans();
            } else {
                this.switchView('view-borrower-info');
            }
        });
    },

    logout: function() {
        auth.signOut().then(() => {
            window.location.reload();
        });
    },

    // ---------------- BORROWER FUNCTIONS ----------------
    saveBorrowerInfo: function() {
        const data = {
            name: document.getElementById('b_name').value,
            phone: document.getElementById('b_phone').value,
            address: document.getElementById('b_address').value,
            profileComplete: true,
            email: this.currentUser.email
        };
        db.collection('users').doc(this.currentUser.uid).set(data, {merge: true}).then(() => {
            Swal.fire('สำเร็จ', 'บันทึกข้อมูลเรียบร้อย', 'success');
            this.switchView('view-borrower-dashboard');
            this.loadAvailableLoans();
        });
    },

    skipBorrowerInfo: function() {
        db.collection('users').doc(this.currentUser.uid).set({ profileComplete: false }, {merge: true});
        this.switchView('view-borrower-dashboard');
        this.loadAvailableLoans();
    },

    loadAvailableLoans: function() {
        const container = document.getElementById('loanCardsContainer');
        container.innerHTML = '<div class="text-center w-100"><div class="spinner-border text-primary"></div></div>';
        
        db.collection('loans').get().then(snapshot => {
            container.innerHTML = '';
            const now = new Date().getTime();

            snapshot.forEach(doc => {
                const loan = doc.data();
                const start = new Date(loan.startDate).getTime();
                const end = new Date(loan.endDate).getTime();
                
                // ถ่าหมดเขตเกิน 24 ชม ซ่อนไปเลย
                if (now > end + (24 * 60 * 60 * 1000)) return;

                let btnHtml = `<button class="btn btn-primary w-100" onclick="app.applyLoan('${doc.id}')">ยื่นสินเชื่อ</button>`;
                let cardClass = "";

                if (now < start) {
                    btnHtml = `<button class="btn btn-secondary w-100" disabled>ยังไม่ถึงระยะเวลา</button>`;
                } else if (now > end) {
                    btnHtml = `<button class="btn btn-secondary w-100" disabled>หมดเขตการยื่นสินเชื่อ</button>`;
                    cardClass = "card-expired";
                }

                container.innerHTML += `
                    <div class="col-md-4 mb-4">
                        <div class="card p-3 loan-card shadow-sm ${cardClass}" onclick="app.showLoanDetails('${doc.id}')">
                            <h5 class="text-primary fw-bold">${loan.name}</h5>
                            <p class="mb-1 text-muted">รหัส: ${loan.idString}</p>
                            <h4 class="mb-3">วงเงิน: ${Number(loan.amount).toLocaleString()} บาท</h4>
                            ${btnHtml}
                        </div>
                    </div>
                `;
            });
        });
    },

    showLoanDetails: async function(loanId) {
        const doc = await db.collection('loans').doc(loanId).get();
        const loan = doc.data();
        
        Swal.fire({
            title: `<strong>${loan.name}</strong>`,
            html: `
                <div class="text-start fs-6">
                    <p><b>รหัสสินเชื่อ:</b> ${loan.idString}</p>
                    <p><b>วงเงิน:</b> ${Number(loan.amount).toLocaleString()} บาท</p>
                    <p><b>รายละเอียด:</b> ${loan.details}</p>
                    <p><b>เงื่อนไขพิจารณา:</b> ${loan.conditions}</p>
                    <p class="text-danger"><b>หมดเขตยื่น:</b> ${new Date(loan.endDate).toLocaleString('th-TH')}</p>
                </div>
            `,
            showCloseButton: true,
            confirmButtonText: 'ปิดหน้าต่าง'
        });
    },

    applyLoan: async function(loanId) {
        event.stopPropagation(); // Prevent card click
        // 1. เช็คประวัติการกรอกข้อมูล
        const userDoc = await db.collection('users').doc(this.currentUser.uid).get();
        if (!userDoc.data().profileComplete) {
            Swal.fire('แจ้งเตือน', 'กรุณากรอกข้อมูลส่วนตัวก่อนทำการยื่นสินเชื่อ', 'warning').then(()=> {
                this.switchView('view-borrower-info');
            });
            return;
        }

        // 2. ดึงข้อมูลสินเชื่อเพื่อดูคำถามเพิ่มเติมและ GPS
        const loanDoc = await db.collection('loans').doc(loanId).get();
        const loan = loanDoc.data();
        
        let gpsData = null;
        if (loan.reqGps) {
            try {
                const pos = await this.getCurrentPosition();
                gpsData = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            } catch (err) {
                Swal.fire('ข้อผิดพลาด', 'ต้องอนุญาตการเข้าถึงตำแหน่งที่ตั้งจึงจะยื่นสินเชื่อนี้ได้', 'error');
                return;
            }
        }

        // สร้าง Application
        const appData = {
            loanId: loanId,
            loanName: loan.name,
            userId: this.currentUser.uid,
            userName: userDoc.data().name,
            appliedAt: new Date().toISOString(),
            status: 1, // 1: ส่งคำขอ, 2: กำลังตรวจ, 3: ตรวจเสร็จ (รออนุมัติ), 4: อนุมัติ, 5: ไม่อนุมัติ
            statusHistory: [{ status: 1, date: new Date().toISOString(), remark: 'ยื่นคำขอสำเร็จ' }],
            gps: gpsData
        };

        db.collection('applications').add(appData).then(() => {
            Swal.fire('สำเร็จ', 'ยื่นคำขอสินเชื่อเรียบร้อยแล้ว ระบบจะอัปเดตสถานะผ่านอีเมล', 'success');
            // ส่งอีเมล (ทำงานผ่าน Cloud Functions แบบเบื้องหลัง)
        });
    },

    getCurrentPosition: function() {
        return new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject);
        });
    },

    loadMyApplications: function() {
        const container = document.getElementById('myApplicationsContainer');
        db.collection('applications').where('userId', '==', this.currentUser.uid).get().then(snap => {
            container.innerHTML = '';
            snap.forEach(doc => {
                const app = doc.data();
                container.innerHTML += `
                    <div class="card mb-3 shadow-sm">
                        <div class="card-body">
                            <h5>${app.loanName}</h5>
                            <p class="text-muted fs-6">ยื่นเมื่อ: ${new Date(app.appliedAt).toLocaleString('th-TH')}</p>
                            <ul class="timeline mt-3">
                                ${this.renderTimeline(app)}
                            </ul>
                        </div>
                    </div>
                `;
            });
        });
    },

    renderTimeline: function(appData) {
        let html = '';
        const states = [
            { id: 1, text: 'ส่งคำขอพิจารณาแล้ว' },
            { id: 2, text: 'กำลังตรวจสอบเอกสารและพิจารณา' },
            { id: 3, text: 'ตรวจสอบเอกสารเสร็จสิ้น (รอผล)' },
            { id: 4, text: 'อนุมัติ / ไม่อนุมัติ' }
        ];

        states.forEach(s => {
            const hist = appData.statusHistory.find(h => h.status === s.id);
            let icon = '<i class="fa-solid fa-circle text-muted"></i>';
            let dateText = '';
            let remarkText = '';

            if (hist) {
                if (s.id === 4) {
                    icon = appData.status === 4 ? '<i class="fa-solid fa-circle-check icon-success"></i>' : '<i class="fa-solid fa-circle-xmark icon-danger"></i>';
                    dateText = new Date(hist.date).toLocaleString('th-TH');
                    s.text = appData.status === 4 ? 'อนุมัติแล้ว' : 'ไม่อนุมัติ';
                } else if (s.id === 3) {
                    // Check date limit logic
                    const deadline = new Date(appData.deadlineDate || new Date().getTime() + 86400000).getTime();
                    const now = new Date().getTime();
                    if (now > deadline && appData.status === 3) {
                        icon = '<i class="fa-solid fa-triangle-exclamation icon-danger"></i>';
                        remarkText = '<br><small class="text-danger">เลยกำหนดเวลา กรุณารอเจ้าหน้าที่ตรวจสอบอีกครั้ง</small>';
                    } else if (appData.status === 3) {
                        icon = '<i class="fa-solid fa-clock icon-pending"></i>';
                    } else {
                        icon = '<i class="fa-solid fa-circle-check icon-success"></i>';
                    }
                    dateText = new Date(hist.date).toLocaleString('th-TH');
                } else {
                    icon = '<i class="fa-solid fa-circle-check icon-success"></i>';
                    dateText = new Date(hist.date).toLocaleString('th-TH');
                }
                remarkText += hist.remark ? `<br><small class="text-secondary">หมายเหตุ: ${hist.remark}</small>` : '';
            }

            html += `
                <li class="timeline-item">
                    <div class="timeline-icon">${icon}</div>
                    <div class="fw-bold">${s.text}</div>
                    ${dateText ? `<div class="text-muted small">${dateText}</div>` : ''}
                    ${remarkText}
                </li>
            `;
        });
        return html;
    },

    // ---------------- STAFF / ADMIN FUNCTIONS ----------------
    showAddLoanModal: function() {
        document.getElementById('l_id').value = 'LN-' + Date.now().toString().slice(-6);
        this.dynamicFields = [];
        document.getElementById('dynamicFieldsContainer').innerHTML = '';
        new bootstrap.Modal(document.getElementById('addLoanModal')).show();
    },

    addDynamicField: function() {
        const id = Date.now();
        this.dynamicFields.push({ id, type: 'text', label: '' });
        this.renderDynamicFields();
    },

    renderDynamicFields: function() {
        const container = document.getElementById('dynamicFieldsContainer');
        container.innerHTML = '';
        this.dynamicFields.forEach((field, index) => {
            container.innerHTML += `
                <div class="input-group mb-2">
                    <select class="form-select" onchange="app.updateDynField(${index}, 'type', this.value)" style="max-width: 120px;">
                        <option value="text">ข้อความ</option>
                        <option value="dropdown">ตัวเลือก</option>
                        <option value="file">อัปโหลด</option>
                    </select>
                    <input type="text" class="form-control" placeholder="ระบุคำถาม..." onchange="app.updateDynField(${index}, 'label', this.value)">
                    <button class="btn btn-danger" type="button" onclick="app.removeDynField(${index})"><i class="fa-solid fa-trash"></i></button>
                </div>
            `;
        });
    },
    updateDynField: function(idx, key, val) { this.dynamicFields[idx][key] = val; },
    removeDynField: function(idx) { this.dynamicFields.splice(idx, 1); this.renderDynamicFields(); },

    createLoan: async function() {
        const file = document.getElementById('l_pdf').files[0];
        if (!file) return Swal.fire('ผิดพลาด', 'กรุณาอัปโหลดหนังสือขออนุญาต (PDF)', 'error');

        Swal.fire({ title: 'กำลังสร้างสินเชื่อ...', allowOutsideClick: false });
        Swal.showLoading();

        // Upload PDF
        const storageRef = storage.ref(`loans_auth_pdf/${Date.now()}_${file.name}`);
        await storageRef.put(file);
        const pdfUrl = await storageRef.getDownloadURL();

        const data = {
            idString: document.getElementById('l_id').value,
            name: document.getElementById('l_name').value,
            amount: document.getElementById('l_amount').value,
            details: document.getElementById('l_details').value,
            conditions: document.getElementById('l_conditions').value,
            startDate: document.getElementById('l_start').value,
            endDate: document.getElementById('l_end').value,
            pdfUrl: pdfUrl,
            reqGps: document.getElementById('l_req_gps').checked,
            customFields: this.dynamicFields,
            createdAt: new Date().toISOString()
        };

        db.collection('loans').add(data).then(() => {
            Swal.fire('สำเร็จ', 'เพิ่มรายการสินเชื่อลงในระบบเรียบร้อยแล้ว', 'success');
            bootstrap.Modal.getInstance(document.getElementById('addLoanModal')).hide();
        });
    },

    loadStaffDashboard: function() {
        const tbody = document.getElementById('staffApplicationsTable');
        const filterDate = document.getElementById('filterDate').value;
        
        let query = db.collection('applications');
        
        query.get().then(snap => {
            tbody.innerHTML = '';
            snap.forEach(doc => {
                const app = doc.data();
                
                // Simple Date Filter
                if (filterDate && !app.appliedAt.startsWith(filterDate)) return;

                let statusBadge = '';
                if(app.status == 1) statusBadge = '<span class="badge bg-secondary">รอตรวจสอบ</span>';
                if(app.status == 2) statusBadge = '<span class="badge bg-warning text-dark">กำลังตรวจสอบ</span>';
                if(app.status == 3) statusBadge = '<span class="badge bg-info">ตรวจสอบเสร็จสิ้น</span>';
                if(app.status == 4) statusBadge = '<span class="badge bg-success">อนุมัติ</span>';
                if(app.status == 5) statusBadge = '<span class="badge bg-danger">ไม่อนุมัติ</span>';

                tbody.innerHTML += `
                    <tr>
                        <td>${app.loanName}</td>
                        <td>${app.userName}</td>
                        <td>${new Date(app.appliedAt).toLocaleDateString('th-TH')}</td>
                        <td>${statusBadge}</td>
                        <td>
                            <button class="btn btn-sm btn-primary" onclick="app.updateStatusModal('${doc.id}', ${app.status})">อัปเดตสถานะ</button>
                        </td>
                    </tr>
                `;
            });
        });
    },

    updateStatusModal: async function(appId, currentStatus) {
        const { value: formValues } = await Swal.fire({
            title: 'อัปเดตสถานะผู้กู้',
            html: `
                <select id="swal-status" class="form-select mb-3">
                    <option value="2" ${currentStatus==1?'selected':''}>กำลังตรวจสอบเอกสาร</option>
                    <option value="3" ${currentStatus==2?'selected':''}>ตรวจสอบเอกสารเสร็จสิ้น</option>
                    <option value="4">อนุมัติ</option>
                    <option value="5">ไม่อนุมัติ</option>
                </select>
                <input id="swal-remark" class="form-control" placeholder="หมายเหตุ (ถ้ามี)">
                ${currentStatus==2 ? '<input type="date" id="swal-deadline" class="form-control mt-3" placeholder="กำหนดเวลาตรวจสอบเสร็จ">' : ''}
            `,
            focusConfirm: false,
            showCancelButton: true,
            preConfirm: () => {
                return {
                    status: parseInt(document.getElementById('swal-status').value),
                    remark: document.getElementById('swal-remark').value,
                    deadline: document.getElementById('swal-deadline') ? document.getElementById('swal-deadline').value : null
                }
            }
        });

        if (formValues) {
            const docRef = db.collection('applications').doc(appId);
            const doc = await docRef.get();
            let history = doc.data().statusHistory;
            
            history.push({
                status: formValues.status,
                date: new Date().toISOString(),
                remark: formValues.remark
            });

            let updateData = { status: formValues.status, statusHistory: history };
            if (formValues.deadline) updateData.deadlineDate = formValues.deadline;

            await docRef.update(updateData);
            Swal.fire('บันทึกสำเร็จ', 'อัปเดตสถานะเรียบร้อยแล้วระบบจะส่งอีเมลแจ้งผู้กู้', 'success');
            this.loadStaffDashboard();
        }
    },

    exportToPDF: function() {
        const element = document.getElementById('staffApplicationsTable');
        html2pdf().from(element).set({
            margin: 1,
            filename: `Report_eLIS_${new Date().toISOString().split('T')[0]}.pdf`,
            html2canvas: { scale: 2 },
            jsPDF: { unit: 'in', format: 'letter', orientation: 'landscape' }
        }).save();
    },

    logIPAndSendEmail: async function(email) {
        // Mockup call to cloud function
        console.log("Triggered Cloud Function to send Login Alert HTML to: " + email);
        // ในระบบจริง จะ POST ไปยัง URL ของ Firebase Cloud Function
    }
};

window.onload = () => { app.init(); };
