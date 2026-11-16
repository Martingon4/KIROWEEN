import { formatMoney, isCents } from './money.ts';

/** Human text for the approval screen, built only from safe preview fields. */
export function describeAction(tool: string, preview: Record<string, unknown>): string {
  const order = typeof preview.orderId === 'string' ? preview.orderId : null;
  const forOrder = order ? ` para orden ${order}` : '';
  switch (tool) {
    case 'issue_refund': {
      const cur = typeof preview.currency === 'string' ? preview.currency : null;
      if (isCents(preview.amountCents) && cur) {
        return `Emitir reembolso simulado de ${formatMoney(preview.amountCents, cur)}${forOrder}`;
      }
      return `Emitir reembolso simulado${forOrder}`;
    }
    case 'send_customer_email':
      return `Enviar correo simulado al cliente${forOrder}`;
    case 'get_order':
      return `Consultar orden${order ? ` ${order}` : ''}`;
    default:
      return `Ejecutar herramienta ${tool}`;
  }
}
