import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { KeyRound, Eye, EyeOff, Loader2, AlertCircle, MailCheck, CheckCircle2 } from 'lucide-react';
import { apis } from '@/lib/ezsite';

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [emailSent, setEmailSent] = useState(false);
  const [resetDone, setResetDone] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setToken(params.get('token'));
  }, []);

  const handleSendEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { error } = await apis().sendResetPwdEmail({ email: email.trim() });
      if (error) { setError(error); return; }
      setEmailSent(true);
    } catch (err: any) {
      setError(err?.message || 'ส่งอีเมลไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < 6) { setError('รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร'); return; }
    setLoading(true);
    try {
      const { error } = await apis().resetPassword({ token: token as string, password });
      if (error) { setError(error); return; }
      setResetDone(true);
      setTimeout(() => navigate('/login'), 3000);
    } catch (err: any) {
      setError(err?.message || 'ตั้งรหัสผ่านใหม่ไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  const Shell = ({ children }: { children: React.ReactNode }) => (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 p-4">
      <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full border border-slate-200">{children}</div>
    </div>
  );

  if (resetDone) {
    return (
      <Shell>
        <div className="text-center">
          <div className="w-16 h-16 bg-emerald-100 rounded-2xl flex items-center justify-center mx-auto mb-4"><CheckCircle2 className="w-8 h-8 text-emerald-600" /></div>
          <h1 className="text-2xl font-bold text-slate-800 mb-2">ตั้งรหัสผ่านใหม่สำเร็จ!</h1>
          <p className="text-slate-600">กำลังไปยังหน้าเข้าสู่ระบบ...</p>
        </div>
      </Shell>
    );
  }

  if (emailSent) {
    return (
      <Shell>
        <div className="text-center">
          <div className="w-16 h-16 bg-emerald-100 rounded-2xl flex items-center justify-center mx-auto mb-4"><MailCheck className="w-8 h-8 text-emerald-600" /></div>
          <h1 className="text-2xl font-bold text-slate-800 mb-2">ส่งอีเมลแล้ว</h1>
          <p className="text-slate-600 mb-4">กรุณาตรวจสอบอีเมล (รวมถึงกล่อง Spam/Junk) และคลิกลิงก์เพื่อตั้งรหัสผ่านใหม่</p>
          <Link to="/login" className="text-teal-600 hover:text-teal-700 font-medium">กลับไปหน้าเข้าสู่ระบบ</Link>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="text-center mb-8">
        <div className="w-16 h-16 bg-teal-500 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-teal-200"><KeyRound className="w-8 h-8 text-white" /></div>
        <h1 className="text-2xl font-bold text-slate-800">{token ? 'ตั้งรหัสผ่านใหม่' : 'ลืมรหัสผ่าน'}</h1>
        <p className="text-slate-500">{token ? 'กรอกรหัสผ่านใหม่ของคุณ' : 'กรอกอีเมลเพื่อรับลิงก์ตั้งรหัสผ่านใหม่'}</p>
      </div>

      {error &&
        <div className="p-3 mb-4 bg-red-50 text-red-600 rounded-lg text-sm border border-red-100 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" /> {error}
        </div>
      }

      {token ? (
        <form onSubmit={handleReset} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">รหัสผ่านใหม่</label>
            <div className="relative">
              <input type={showPassword ? 'text' : 'password'} required value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full border border-slate-300 p-3 pr-11 rounded-lg focus:border-teal-500 outline-none"
                placeholder="อย่างน้อย 6 ตัวอักษร" autoComplete="new-password" />
              <button type="button" onClick={() => setShowPassword((s) => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>
          <button type="submit" disabled={loading}
            className="w-full py-3 bg-teal-600 hover:bg-teal-700 disabled:bg-teal-300 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2">
            {loading && <Loader2 className="w-4 h-4 animate-spin" />} บันทึกรหัสผ่านใหม่
          </button>
        </form>
      ) : (
        <form onSubmit={handleSendEmail} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">อีเมล</label>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
              className="w-full border border-slate-300 p-3 rounded-lg focus:border-teal-500 outline-none"
              placeholder="you@example.com" autoComplete="email" />
          </div>
          <button type="submit" disabled={loading}
            className="w-full py-3 bg-teal-600 hover:bg-teal-700 disabled:bg-teal-300 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2">
            {loading && <Loader2 className="w-4 h-4 animate-spin" />} ส่งลิงก์ตั้งรหัสผ่านใหม่
          </button>
        </form>
      )}

      <p className="text-center text-sm text-slate-500 mt-6">
        <Link to="/login" className="text-teal-600 hover:text-teal-700 font-medium">กลับไปหน้าเข้าสู่ระบบ</Link>
      </p>
    </Shell>
  );
}
