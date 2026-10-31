import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Package, Eye, EyeOff, Loader2, AlertCircle, MailCheck } from 'lucide-react';
import { apis } from '@/lib/ezsite';

export default function RegisterPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [countdown, setCountdown] = useState(5);

  useEffect(() => {
    if (!done) return;
    if (countdown <= 0) { navigate('/login'); return; }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [done, countdown, navigate]);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password !== confirm) { setError('รหัสผ่านทั้งสองช่องไม่ตรงกัน'); return; }
    if (password.length < 6) { setError('รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร'); return; }
    setLoading(true);
    try {
      const { error } = await apis().register({ email: email.trim(), password });
      if (error) { setError(error); return; }
      setDone(true);
    } catch (err: any) {
      setError(err?.message || 'สมัครสมาชิกไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full border border-slate-200 text-center">
          <div className="w-16 h-16 bg-emerald-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <MailCheck className="w-8 h-8 text-emerald-600" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800 mb-2">สมัครสมาชิกสำเร็จ!</h1>
          <p className="text-slate-600 mb-4">
            กรุณาตรวจสอบอีเมลของคุณ (รวมถึงกล่อง Spam/Junk) และคลิกลิงก์ยืนยันเพื่อเปิดใช้งานบัญชีก่อนเข้าสู่ระบบ
          </p>
          <p className="text-sm text-slate-400">กำลังไปยังหน้าเข้าสู่ระบบใน {countdown} วินาที...</p>
          <Link to="/login" className="inline-block mt-4 text-teal-600 hover:text-teal-700 font-medium">ไปที่หน้าเข้าสู่ระบบทันที</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 p-4">
      <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full border border-slate-200">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-teal-500 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-teal-200">
            <Package className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800">สมัครสมาชิก</h1>
          <p className="text-slate-500">สร้างบัญชีเพื่อเข้าใช้งานระบบ</p>
        </div>

        <form onSubmit={handleRegister} className="space-y-4">
          {error &&
            <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm border border-red-100 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" /> {error}
            </div>
          }

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">อีเมล</label>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
              className="w-full border border-slate-300 p-3 rounded-lg focus:border-teal-500 outline-none transition-colors"
              placeholder="you@example.com" autoComplete="email" />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">รหัสผ่าน</label>
            <div className="relative">
              <input type={showPassword ? 'text' : 'password'} required value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full border border-slate-300 p-3 pr-11 rounded-lg focus:border-teal-500 outline-none transition-colors"
                placeholder="อย่างน้อย 6 ตัวอักษร" autoComplete="new-password" />
              <button type="button" onClick={() => setShowPassword((s) => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">ยืนยันรหัสผ่าน</label>
            <input type={showPassword ? 'text' : 'password'} required value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="w-full border border-slate-300 p-3 rounded-lg focus:border-teal-500 outline-none transition-colors"
              placeholder="••••••••" autoComplete="new-password" />
          </div>

          <button type="submit" disabled={loading}
            className="w-full py-3 mt-2 bg-teal-600 hover:bg-teal-700 disabled:bg-teal-300 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2">
            {loading && <Loader2 className="w-4 h-4 animate-spin" />} สมัครสมาชิก
          </button>
        </form>

        <p className="text-center text-sm text-slate-500 mt-6">
          มีบัญชีอยู่แล้ว? <Link to="/login" className="text-teal-600 hover:text-teal-700 font-medium">เข้าสู่ระบบ</Link>
        </p>
      </div>
    </div>
  );
}
