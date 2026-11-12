import type { Metadata } from 'next';
import '@fontsource-variable/golos-text';
import './globals.css';

export const metadata: Metadata = {
  title: 'EduID — учебный профиль',
  description: 'Вход и регистрация в EduID для учеников и организаций.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><body>{children}</body></html>;
}
