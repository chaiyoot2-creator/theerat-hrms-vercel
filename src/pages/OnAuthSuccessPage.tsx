import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { CheckCircle2 } from 'lucide-react';

export default function OnAuthSuccessPage() {
  const navigate = useNavigate();
  const [countdown, setCountdown] = useState(5);

  useEffect(() => {
    if (countdown <= 0) { navigate('/login'); return; }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 p-4">
      <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full border border-slate-200 text-center">
        <div className="w-16 h-16 bg-emerald-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <CheckCircle2 className="w-8 h-8 text-emerald-600" />
        </div>
        <h1 className="text-2xl font-bold text-slate-800 mb-2">ยืนยันบัญชีสำเร็จ!</h1>
        <p className="text-slate-600 mb-4">บัญชีของคุณถูกเปิดใช้งานเรียบร้อยแล้ว</p>
        <p className="text-sm text-slate-400">กำลังไปยังหน้าเข้าสู่ระบบใน {countdown} วินาที...</p>
        <Link to="/login" className="inline-block mt-4 text-teal-600 hover:text-teal-700 font-medium">ไปที่หน้าเข้าสู่ระบบทันที</Link>
      </div>
    </div>
  );
}
