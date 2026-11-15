import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { useProductName } from '@/hooks/use-product-name.ts';
import { api } from '@/lib/api';
import { useTour } from '@/pages/tour/TourController.tsx';
import type { Order } from '@valio/shared';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router';
import { Header } from '../../components/Header';

export default function AimoPickingDashboardConfirmPage() {
  const { t } = useTranslation();
  const { state } = useLocation();
  const order = state as Order;
  const navigate = useNavigate();
  const { fulfillStep } = useTour();
  const getTranslatedProductName = useProductName();

  async function confirm() {
    try {
      const notification = await api.createNotification({
        title: 'Your order has missing items',
        message: 'Some items were not available. Go to My Orders to select alternatives.',
        orderId: order.id,
      });
      console.log('Notification created with ID: ', notification.id);
    } catch (error) {
      console.error('Error creating notification: ', error);
    }

    navigate('/aimo/orders');
    fulfillStep('warehouse_order_picking');
  }

  return (
    <div>
      <Header />
      <div className="hero-container p-4">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink href="/aimo">{t('warehouse_application')}</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink href="/aimo/orders">{t('warehouse_orders')}</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink href={`/aimo/orders/${order.id}/picking-dashboard`}>
                {t('warehouse_order_picking')}
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{t('warehouse_order_picking_confirmation_short')}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <div className="hero mt-4">
          <h1 className={'text-lg font-bold'}>{t('warehouse_order_picking_confirmation')}</h1>
          <h3 className={'text-gray-800 dark:text-gray-400'}>
            {t('warehouse_order_picking_confirmation_subtitle')}
          </h3>
        </div>

        <div className="flex flex-col gap-4 mt-6">
          {Object.values(order.products).map((product) => (
            <div className="p-4 flex flex-row border rounded-lg">
              <h3 className="flex flex-2">{getTranslatedProductName(product)}</h3>
              <p className="flex flex-1">Ordered Quantity: {product.orderedQuantity}</p>
              <p className="flex flex-1">Picked Quantity: {product.pickEvent?.quantity ?? 0}</p>
            </div>
          ))}
          <Button
            onClick={confirm}
            className="w-64 self-end">
            Confirm and notify client
          </Button>
        </div>
      </div>
    </div>
  );
}
