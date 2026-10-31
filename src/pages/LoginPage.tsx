import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Package, Eye, EyeOff, Loader2, AlertCircle } from 'lucide-react';
import { apis } from '@/lib/ezsite';

export default function LoginPage() {
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      // The API accepts either an email or an employee username here.
      const { error } = await apis().login({ email: identifier.trim(), password });
      if (error) {
        setError(error);
        return;
      }
      navigate('/');
    } catch (err: any) {
      setError(err?.message || 'เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 p-4">
      <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full border border-slate-200">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-teal-500 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-teal-200">
            <Package className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800">THEERAT HRMS Pro</h1>
          <p className="text-slate-500">ระบบบริหารงานบุคคล หจก.ธีรัตม์อาหารสัตว์</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          {error &&
            <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm border border-red-100 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" /> {error}
            </div>
          }

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">ชื่อผู้ใช้หรืออีเมล</label>
            <input
              type="text" required value={identifier} onChange={(e) => setIdentifier(e.target.value)}
              className="w-full border border-slate-300 p-3 rounded-lg focus:border-teal-500 outline-none transition-colors"
              placeholder="username หรือ you@example.com" autoComplete="username" />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">รหัสผ่าน</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'} required value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full border border-slate-300 p-3 pr-11 rounded-lg focus:border-teal-500 outline-none transition-colors"
                placeholder="••••••••" autoComplete="current-password" />
              <button type="button" onClick={() => setShowPassword((s) => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          <div className="flex justify-end">
            <Link to="/resetpassword" className="text-sm text-teal-600 hover:text-teal-700 font-medium">ลืมรหัสผ่าน?</Link>
          </div>

          <button type="submit" disabled={loading}
            className="w-full py-3 mt-2 bg-teal-600 hover:bg-teal-700 disabled:bg-teal-300 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2">
            {loading && <Loader2 className="w-4 h-4 animate-spin" />} เข้าสู่ระบบ
          </button>
        </form>

        <p className="text-center text-sm text-slate-500 mt-6">
          ยังไม่มีบัญชี? <Link to="/register" className="text-teal-600 hover:text-teal-700 font-medium">สมัครสมาชิก</Link>
        </p>
      </div>
    </div>
  );
}
