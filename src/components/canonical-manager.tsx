import { useLocation, Outlet } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';

export const CanonicalManager = () => {
  const location = useLocation();
  const canonical = window.location.origin + location.pathname;

  return (
    <>
      <Helmet>
        <link rel="canonical" href={canonical} />
      </Helmet>
      <Outlet />
    </>
  );
};
