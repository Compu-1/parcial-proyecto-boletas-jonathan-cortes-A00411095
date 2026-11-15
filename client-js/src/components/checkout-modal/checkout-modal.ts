import type { AppState, SeatView } from '../../state/types.ts';
import { type Component, el } from '../component.ts';
import { formatCountdown, formatMoney, secondsLeft } from '../format.ts';
import { createReceipt } from '../receipt/receipt.ts';
import './checkout-modal.css';

export interface CheckoutIntents {
  onConfirm(name: string, email: string): void;
  onClose(): void;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Field {
  input: HTMLInputElement;
  error: HTMLElement;
  validate(value: string): string;
}

function createField(
  id: string,
  label: string,
  type: string,
  autocomplete: AutoFill,
  validate: (value: string) => string,
): { wrapper: HTMLElement; field: Field } {
  const wrapper = el('div', 'field');
  const labelEl = el('label', 'field__label', label);
  labelEl.htmlFor = id;
  const input = el('input', 'field__input');
  input.id = id;
  input.type = type;
  input.autocomplete = autocomplete;
  input.required = true;
  const error = el('p', 'field__error');
  error.id = `${id}-error`;
  input.setAttribute('aria-describedby', error.id);
  wrapper.append(labelEl, input, error);
  return { wrapper, field: { input, error, validate } };
}

export function createCheckoutModal(intents: CheckoutIntents): Component {
  const dialog = el('dialog', 'checkout');
  dialog.setAttribute('aria-labelledby', 'checkout-title');

  // ---- Form view ----
  const formView = el('div', 'checkout__view');
  const header = el('div', 'checkout__header');
  const titleBox = el('div');
  const title = el('h2', 'checkout__title', 'Datos del comprador');
  title.id = 'checkout-title';
  titleBox.append(
    title,
    el('p', 'checkout__subtitle', 'Ingresa tus datos para emitir el boleto.'),
  );
  const closeButton = el('button', 'icon-button', '×');
  closeButton.type = 'button';
  closeButton.setAttribute('aria-label', 'Cerrar');
  header.append(titleBox, closeButton);

  const summary = el('div', 'checkout__summary');
  const summarySeats = el('p', 'checkout__summary-seats');
  const summaryTimer = el('p', 'checkout__summary-timer numeric');
  summary.append(summarySeats, summaryTimer);

  const form = el('form', 'checkout__form');
  form.noValidate = true; // we show our own Spanish messages
  const name = createField(
    'checkout-name',
    'Nombre completo',
    'text',
    'name',
    value =>
      value.trim().length >= 3
        ? ''
        : 'Escribe tu nombre completo (mínimo 3 caracteres).',
  );
  const email = createField(
    'checkout-email',
    'Correo electrónico',
    'email',
    'email',
    value =>
      EMAIL_PATTERN.test(value.trim())
        ? ''
        : 'Escribe un correo válido, por ejemplo nombre@correo.com.',
  );
  const fields = [name.field, email.field];

  const formActions = el('div', 'checkout__actions');
  const submit = el(
    'button',
    'button button--primary button--block',
    'Finalizar y pagar',
  );
  submit.type = 'submit';
  const back = el(
    'button',
    'button button--secondary button--block',
    'Volver al mapa',
  );
  back.type = 'button';
  formActions.append(submit, back);
  form.append(name.wrapper, email.wrapper, formActions);
  formView.append(header, summary, form);

  // ---- Receipt view ----
  const receiptView = el('div', 'checkout__view');
  const receipt = createReceipt();
  receipt.mount(receiptView);
  const done = el(
    'button',
    'button button--primary button--block',
    'Volver al mapa',
  );
  done.type = 'button';
  receiptView.append(done);

  dialog.append(formView, receiptView);

  let mine: SeatView[] = [];
  let submitting = false;
  let interval: number | undefined;
  let returnFocus: HTMLElement | null = null;

  /** Shows or clears the field's error; returns true when valid. */
  function check(field: Field): boolean {
    const message = field.validate(field.input.value);
    field.error.textContent = message;
    field.input.setAttribute('aria-invalid', String(message !== ''));
    return message === '';
  }

  function tick() {
    const times = mine
      .map(seat => seat.expiresAt)
      .filter((t): t is number => t !== null);
    if (times.length > 0) {
      summaryTimer.textContent = `Retención activa: ${formatCountdown(secondsLeft(Math.min(...times)))} restantes`;
    }
  }

  function open() {
    returnFocus = document.activeElement as HTMLElement | null;
    form.reset();
    for (const field of fields) {
      field.error.textContent = '';
      field.input.removeAttribute('aria-invalid');
    }
    dialog.showModal();
    name.field.input.focus();
    interval = window.setInterval(tick, 1000);
    tick();
  }

  function close() {
    window.clearInterval(interval);
    interval = undefined;
    dialog.close();
    returnFocus?.focus();
  }

  function onSubmit(event: SubmitEvent) {
    event.preventDefault();
    // Check every field (no short-circuit) so all errors show at once.
    const results = fields.map(check);
    const firstInvalid = fields[results.indexOf(false)];
    if (firstInvalid) {
      firstInvalid.input.focus();
      return;
    }
    intents.onConfirm(
      name.field.input.value.trim(),
      email.field.input.value.trim(),
    );
  }

  function onBlur(event: FocusEvent) {
    const field = fields.find(f => f.input === event.target);
    if (field && field.input.value !== '') {
      check(field);
    }
  }

  /** Esc: the store decides; never close while the booking is in flight. */
  function onCancel(event: Event) {
    event.preventDefault();
    if (!submitting) {
      intents.onClose();
    }
  }

  function onClose() {
    intents.onClose();
  }

  form.addEventListener('submit', onSubmit);
  form.addEventListener('focusout', onBlur);
  dialog.addEventListener('cancel', onCancel);
  closeButton.addEventListener('click', onClose);
  back.addEventListener('click', onClose);
  done.addEventListener('click', onClose);

  return {
    mount(parent) {
      parent.append(dialog);
    },
    update(state: AppState) {
      const { checkout } = state;
      mine = state.seats.filter(seat => seat.status === 'mine');
      submitting = checkout.submitting;

      if (checkout.open && !dialog.open) {
        open();
      } else if (!checkout.open && dialog.open) {
        close();
      }
      if (!dialog.open) {
        return;
      }

      receipt.update(state);
      const showReceipt = checkout.receipt !== null;
      formView.hidden = showReceipt;
      receiptView.hidden = !showReceipt;
      if (showReceipt && !receiptView.contains(document.activeElement)) {
        done.focus();
      }

      const total = mine.reduce((acc, seat) => acc + seat.price, 0);
      summarySeats.textContent = `Sillas: ${mine.map(s => s.id).join(', ')} · Total: ${formatMoney(total)}`;

      submit.disabled = submitting || state.connection !== 'connected';
      submit.textContent = submitting ? 'Procesando…' : 'Finalizar y pagar';
      back.disabled = submitting;
      closeButton.disabled = submitting;
    },
    destroy() {
      window.clearInterval(interval);
      form.removeEventListener('submit', onSubmit);
      form.removeEventListener('focusout', onBlur);
      dialog.removeEventListener('cancel', onCancel);
      closeButton.removeEventListener('click', onClose);
      back.removeEventListener('click', onClose);
      done.removeEventListener('click', onClose);
      receipt.destroy();
      dialog.remove();
    },
  };
}
