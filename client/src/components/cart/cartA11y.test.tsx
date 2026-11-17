// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { CartItemCard } from './CartItemCard';

beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('cart accessibility', () => {
    it('names the remove button and links the assign label to its select', () => {
        const host = document.createElement('div');
        const root = createRoot(host);
        const onRemove = vi.fn();
        const item = { id: 'i1', testCode: 'CBC', testName: 'Complete Blood Count', price: 300, mrp: null, patientId: null, patient: null };
        act(() => root.render(
            <CartItemCard item={item as never} patients={[]} onRemove={onRemove} onUpdatePatient={vi.fn()} isUnavailable onAddNewMember={vi.fn()} />
        ));
        const remove = host.querySelector('button[aria-label="Remove Complete Blood Count from cart"]') as HTMLButtonElement;
        expect(remove).not.toBeNull();
        act(() => remove.click());
        expect(onRemove).toHaveBeenCalledWith('i1');
        expect(host.querySelector('[role="alert"]')).not.toBeNull();
        expect(host.querySelector('label[for="assign-i1"]')).not.toBeNull();
        expect(host.querySelector('select#assign-i1')).not.toBeNull();
        act(() => root.unmount());
    });
});
