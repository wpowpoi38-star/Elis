const functions = require('firebase-functions');
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');

admin.initializeApp();

// ตั้งค่า SMTP ของ Gmail (แนะนำให้ใช้ App Passwords ของ Gmail)
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'YOUR_EMAIL@gmail.com',
        pass: 'YOUR_APP_PASSWORD'
    }
});

// 1. ฟังก์ชันส่งอีเมลเมื่อสถานะเปลี่ยน (Triggered by Firestore)
exports.onApplicationStatusUpdate = functions.firestore
    .document('applications/{appId}')
    .onUpdate(async (change, context) => {
        const newData = change.after.data();
        const oldData = change.before.data();

        if (newData.status !== oldData.status) {
            // ค้นหาอีเมลผู้กู้
            const userDoc = await admin.firestore().collection('users').doc(newData.userId).get();
            const userEmail = userDoc.data().email;

            let statusText = "";
            if(newData.status == 2) statusText = "กำลังตรวจสอบเอกสารและพิจารณา";
            if(newData.status == 3) statusText = "ตรวจสอบเอกสารเสร็จสิ้น";
            if(newData.status == 4) statusText = "อนุมัติสินเชื่อ";
            if(newData.status == 5) statusText = "ไม่อนุมัติสินเชื่อ";

            const mailOptions = {
                from: 'e-LIS System <noreply@elis.com>',
                to: userEmail,
                subject: `อัปเดตสถานะสินเชื่อ: ${newData.loanName}`,
                html: `
                    <div style="font-family: Arial; padding: 20px; border: 1px solid #ddd; border-radius: 8px;">
                        <h2 style="color: #0d6efd;">e-Lending Information System</h2>
                        <p>เรียน คุณ ${newData.userName}</p>
                        <p>สถานะคำขอสินเชื่อ <b>${newData.loanName}</b> ของคุณมีการเปลี่ยนแปลง</p>
                        <h3 style="background-color: #f8f9fa; padding: 10px; border-left: 4px solid #0d6efd;">
                            สถานะปัจจุบัน: ${statusText}
                        </h3>
                        <p>เข้าสู่ระบบเพื่อดูรายละเอียดเพิ่มเติม</p>
                    </div>
                `
            };
            return transporter.sendMail(mailOptions);
        }
        return null;
    });

// 2. HTTP Endpoint สำหรับส่งอีเมลแจ้งเตือนการเข้าสู่ระบบแบบมีปุ่มระงับบัญชี (Lock Account)
exports.sendLoginAlert = functions.https.onCall(async (data, context) => {
    const { email, ipAddress, device, uid, role } = data;
    
    // สร้าง Link สำหรับกดล็อกบัญชี (ชี้มาที่ HTTP Trigger อีกตัว)
    const lockUrl = `https://us-central1-YOUR_PROJECT.cloudfunctions.net/lockAccount?uid=${uid}&role=${role}`;

    const mailOptions = {
        from: 'e-LIS Security <security@elis.com>',
        to: email,
        subject: `[แจ้งเตือนความปลอดภัย] มีการเข้าสู่ระบบ e-LIS ใหม่`,
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto;">
                <h2 style="color: #dc3545;">แจ้งเตือนการเข้าสู่ระบบใหม่</h2>
                <p>พบการเข้าสู่ระบบบัญชีของคุณเมื่อเวลา: ${new Date().toLocaleString('th-TH')}</p>
                <ul>
                    <li><b>IP Address:</b> ${ipAddress || 'ไม่ทราบ'}</li>
                    <li><b>อุปกรณ์:</b> ${device || 'ไม่ทราบ'}</li>
                </ul>
                <hr>
                <p style="color: red; font-weight: bold;">หากคุณไม่ได้เป็นคนเข้าสู่ระบบ โปรดคลิกปุ่มต่อไปนี้เพื่อระงับการใช้งานชั่วคราว</p>
                <a href="${lockUrl}" style="background-color: #dc3545; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">
                    ล็อกการใช้งานทันที
                </a>
                <br><br>
                <small>*เมื่อถูกล็อก บัญชีจะไม่สามารถเข้าใช้งานได้ จะขึ้นว่า "ถูกล็อกโดยผู้ดูแลระบบ กรุณาติดต่อผู้ดูแลระบบ"</small>
            </div>
        `
    };
    await transporter.sendMail(mailOptions);
    return { success: true };
});

// 3. HTTP Trigger สำหรับล็อกบัญชีเมื่อคลิกจากอีเมล
exports.lockAccount = functions.https.onRequest(async (req, res) => {
    const uid = req.query.uid;
    const role = req.query.role; // 'staff' หรือ 'borrower'
    
    try {
        const collection = role === 'staff' ? 'staffs' : 'users';
        await admin.firestore().collection(collection).doc(uid).update({
            isLocked: true
        });
        res.status(200).send("<h1>ล็อกบัญชีสำเร็จ</h1><p>บัญชีนี้ถูกระงับการใช้งานเรียบร้อยแล้ว กรุณาติดต่อผู้ดูแลระบบเพื่อปลดล็อก</p>");
    } catch (error) {
        res.status(500).send("เกิดข้อผิดพลาด: " + error.message);
    }
});
