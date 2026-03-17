import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Activity, Settings2, WalletCards, X } from 'lucide-react';
import { toast } from 'sonner';
import { useDashboard } from '@/context/DashboardContext';

interface DashboardHeaderProps {
  activeTab: number;
  onTabChange: (tab: number) => void;
}

const tabs = [
  { label: 'Adres Ekle', icon: '➕' },
  { label: 'Gerçek Trade', icon: '⚡' },
];

const ADD_WALLET_VALUE = '__add_wallet__';

type WalletFormState = {
  nickName: string;
  privateKey: string;
  funderAddress: string;
};

const emptyWalletForm: WalletFormState = {
  nickName: '',
  privateKey: '',
  funderAddress: '',
};

export default function DashboardHeader({ activeTab, onTabChange }: DashboardHeaderProps) {
  const {
    executionWallets,
    selectedExecutionWalletId,
    selectedExecutionWallet,
    selectExecutionWallet,
    addExecutionWallet,
    updateExecutionWallet,
  } = useDashboard();
  const [isAddWalletOpen, setIsAddWalletOpen] = useState(false);
  const [isManageWalletOpen, setIsManageWalletOpen] = useState(false);
  const [walletForm, setWalletForm] = useState<WalletFormState>(emptyWalletForm);
  const [managingWalletId, setManagingWalletId] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);

  const walletSelectValue = selectedExecutionWalletId || '';
  const helperText = useMemo(() => {
    if (!selectedExecutionWallet) return 'Henüz execution wallet seçilmedi';
    return `${selectedExecutionWallet.nickName}${selectedExecutionWallet.source === 'legacy' ? ' • legacy env' : ''}`;
  }, [selectedExecutionWallet]);
  const managedWallets = useMemo(
    () => executionWallets.filter((wallet) => wallet.source === 'managed'),
    [executionWallets],
  );

  const resetWalletForm = () => {
    setWalletForm(emptyWalletForm);
    setIsSaving(false);
  };

  const closeAddWalletModal = () => {
    setIsAddWalletOpen(false);
    resetWalletForm();
  };

  const closeManageWalletModal = () => {
    setIsManageWalletOpen(false);
    setManagingWalletId('');
    resetWalletForm();
  };

  const handleWalletSelect = (value: string) => {
    if (value === ADD_WALLET_VALUE) {
      setIsAddWalletOpen(true);
      return;
    }
    selectExecutionWallet(value || null);
  };

  const handleWalletFormChange = (key: keyof WalletFormState, value: string) => {
    setWalletForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSaveWallet = async () => {
    if (!walletForm.nickName.trim() || !walletForm.privateKey.trim() || !walletForm.funderAddress.trim()) {
      toast.error('Nick_Name, POLYMARKET_PRIVATE_KEY ve POLYMARKET_FUNDER_ADDRESS zorunlu.');
      return;
    }

    setIsSaving(true);
    try {
      const wallet = await addExecutionWallet({
        nickName: walletForm.nickName,
        privateKey: walletForm.privateKey,
        funderAddress: walletForm.funderAddress,
      });
      toast.success(`${wallet.nickName} eklendi ve aktif wallet olarak seçildi.`);
      closeAddWalletModal();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Wallet eklenemedi');
      setIsSaving(false);
    }
  };

  const openManageWalletModal = () => {
    if (managedWallets.length === 0) {
      toast.error('Düzenlenebilir wallet yok. Önce yeni bir wallet ekleyin.');
      return;
    }
    const initialWalletId = managedWallets.find((wallet) => wallet.id === selectedExecutionWalletId)?.id || managedWallets[0].id;
    setManagingWalletId(initialWalletId);
    setIsManageWalletOpen(true);
  };

  useEffect(() => {
    if (!isManageWalletOpen || !managingWalletId) return;
    const targetWallet = managedWallets.find((wallet) => wallet.id === managingWalletId);
    if (!targetWallet) return;
    setWalletForm({
      nickName: targetWallet.nickName,
      privateKey: targetWallet.privateKey,
      funderAddress: targetWallet.funderAddress,
    });
  }, [isManageWalletOpen, managedWallets, managingWalletId]);

  const handleUpdateWallet = async () => {
    if (!managingWalletId) {
      toast.error('Düzenlenecek wallet seçin.');
      return;
    }
    if (!walletForm.nickName.trim() || !walletForm.privateKey.trim() || !walletForm.funderAddress.trim()) {
      toast.error('Nick_Name, POLYMARKET_PRIVATE_KEY ve POLYMARKET_FUNDER_ADDRESS zorunlu.');
      return;
    }

    setIsSaving(true);
    try {
      const wallet = await updateExecutionWallet({
        id: managingWalletId,
        nickName: walletForm.nickName,
        privateKey: walletForm.privateKey,
        funderAddress: walletForm.funderAddress,
      });
      toast.success(`${wallet.nickName} güncellendi.`);
      closeManageWalletModal();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Wallet güncellenemedi');
      setIsSaving(false);
    }
  };

  return (
    <>
      <header className="border-b border-border/50 backdrop-blur-xl bg-background/80 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between gap-4 min-h-16 py-3">
            <div className="flex items-center gap-3 shrink-0">
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center glow-border">
                <Activity className="w-5 h-5 text-primary" />
              </div>
              <h1 className="text-lg font-bold tracking-tight">
                <span className="gradient-text">Poly</span>
                <span className="text-foreground">Tracker</span>
              </h1>
            </div>

            <div className="flex-1 max-w-md">
              <div className="flex items-center justify-between mb-1">
                <label className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground block">
                  Aktif Trade Wallet
                </label>
                <button
                  type="button"
                  onClick={openManageWalletModal}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border/30 text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                  title="Wallet ayarları"
                >
                  <Settings2 className="w-4 h-4" />
                </button>
              </div>
              <div className="relative">
                <WalletCards className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <select
                  value={walletSelectValue}
                  onChange={(e) => handleWalletSelect(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 rounded-lg bg-secondary/50 border border-border/30 text-sm text-foreground"
                >
                  {executionWallets.length === 0 && (
                    <option value="">Wallet ekleyin...</option>
                  )}
                  {executionWallets.map((wallet) => (
                    <option key={wallet.id} value={wallet.id}>
                      {wallet.nickName}
                    </option>
                  ))}
                  <option value={ADD_WALLET_VALUE}>+ Wallet Ekle</option>
                </select>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1 truncate">{helperText}</p>
            </div>

            <nav className="flex items-center gap-1 shrink-0">
              {tabs.map((tab, i) => (
                <button
                  key={i}
                  onClick={() => onTabChange(i)}
                  className={`
                    px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200
                    ${activeTab === i
                      ? 'bg-primary/10 text-primary glow-border'
                      : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
                    }
                  `}
                >
                  <span className="mr-1.5">{tab.icon}</span>
                  <span className="hidden sm:inline">{tab.label}</span>
                </button>
              ))}
            </nav>
          </div>
        </div>
      </header>

      {isAddWalletOpen && (
        <WalletModal
          title="Wallet Ekle"
          description="Bu wallet yeni gerçek trade session’larında kullanılacak."
          isSaving={isSaving}
          form={walletForm}
          onChange={handleWalletFormChange}
          onClose={closeAddWalletModal}
          onSave={() => { void handleSaveWallet(); }}
          saveLabel={isSaving ? 'Kaydediliyor...' : 'Wallet Kaydet'}
        />
      )}

      {isManageWalletOpen && (
        <WalletModal
          title="Wallet Ayarları"
          description="Eklenen wallet bilgilerini buradan güncelleyebilirsiniz."
          isSaving={isSaving}
          form={walletForm}
          onChange={handleWalletFormChange}
          onClose={closeManageWalletModal}
          onSave={() => { void handleUpdateWallet(); }}
          saveLabel={isSaving ? 'Kaydediliyor...' : 'Değişiklikleri Kaydet'}
          headerExtra={(
            managedWallets.length > 0 ? (
              <select
                value={managingWalletId}
                onChange={(e) => setManagingWalletId(e.target.value)}
                className="mt-3 w-full px-3 py-2 rounded-lg bg-secondary/50 border border-border/30 text-sm"
              >
                {managedWallets.map((wallet) => (
                  <option key={wallet.id} value={wallet.id}>
                    {wallet.nickName}
                  </option>
                ))}
              </select>
            ) : (
              <div className="mt-3 rounded-lg border border-border/30 bg-secondary/20 px-3 py-2 text-sm text-muted-foreground">
                Düzenlenebilir wallet yok.
              </div>
            )
          )}
        />
      )}
    </>
  );
}

function WalletModal({
  title,
  description,
  isSaving,
  form,
  onChange,
  onClose,
  onSave,
  saveLabel,
  headerExtra,
}: {
  title: string;
  description: string;
  isSaving: boolean;
  form: WalletFormState;
  onChange: (key: keyof WalletFormState, value: string) => void;
  onClose: () => void;
  onSave: () => void;
  saveLabel: string;
  headerExtra?: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-background/80 backdrop-blur-sm px-4">
      <div className="w-full max-w-lg rounded-2xl border border-border/40 bg-card/95 shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/30">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-foreground">{title}</h2>
            <p className="text-xs text-muted-foreground">{description}</p>
            {headerExtra}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border/30 text-muted-foreground hover:text-foreground hover:bg-secondary/50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">Nick_Name</span>
            <input
              type="text"
              value={form.nickName}
              onChange={(e) => onChange('nickName', e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-secondary/50 border border-border/30 text-sm"
              placeholder="Örn: Main Wallet"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">POLYMARKET_PRIVATE_KEY</span>
            <input
              type="password"
              value={form.privateKey}
              onChange={(e) => onChange('privateKey', e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-secondary/50 border border-border/30 text-sm"
              placeholder="0x..."
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">POLYMARKET_FUNDER_ADDRESS</span>
            <input
              type="text"
              value={form.funderAddress}
              onChange={(e) => onChange('funderAddress', e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-secondary/50 border border-border/30 text-sm"
              placeholder="0x..."
            />
          </label>

          <p className="text-[11px] text-muted-foreground">
            Girilen bilgiler `.env` dosyasına kaydedilir ve yeni order isteklerinde hemen kullanılır.
          </p>
        </div>

        <div className="px-5 py-4 border-t border-border/30 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm border border-border/30 text-muted-foreground hover:text-foreground hover:bg-secondary/50"
          >
            Vazgeç
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={isSaving}
            className="px-4 py-2 rounded-lg text-sm bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20 disabled:opacity-50"
          >
            {saveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
