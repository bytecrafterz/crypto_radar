import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/States';
import { useTitulo } from '../components/ui/PageHeader';

export default function NoEncontrada() {
  useTitulo('No encontrada');
  return (
    <Card>
      <EmptyState icon={<Compass />} title="Pagina no encontrada" text="La direccion no corresponde a ninguna pagina del panel." action={<Link to="/">Volver al resumen</Link>} />
    </Card>
  );
}
