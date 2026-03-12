import { useMemo, useState } from 'react';
import { Activity, WalletCards, X } from 'lucide-react';
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

export default function DashboardHeader({ activeTab, onTabChange }: DashboardHeaderProps) {
  const {
    executionWallets,
    selectedExecutionWalletId,
    selectedExecutionWallet,
    selectExecutionWallet,
    addExecutionWallet,
  } = useDashboard();
  const [isAddWalletOpen, setIsAddWalletOpen] = useState(false);
  const [nickName, setNickName] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [funderAddress, setFunderAddress] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const walletSelectValue = selectedExecutionWalletId || '';
  const walletLabel = selectedExecutionWallet?.nickName || 'Wallet seçin';
  const helperText = useMemo(() => {
    if (!selectedExecutionWallet) return 'Henüz execution wallet seçilmedi';
    return `${selectedExecutionWallet.nickName}${selectedExecutionWallet.source === 'legacy' ? ' • legacy env' : ''}`;
  }, [selectedExecutionWallet]);

  const resetModal = () => {
    setNickName('');
    setPrivateKey('');
    setFunderAddress('');
    setIsSaving(false);
  };

  const closeModal = () => {
    setIsAddWalletOpen(false);
    resetModal();
  };

  const handleWalletSelect = (value: string) => {
    if (value === ADD_WALLET_VALUE) {
      setIsAddWalletOpen(true);
      return;
    }
    selectExecutionWallet(value || null);
  };

  const handleSaveWallet = async () => {
    if (!nickName.trim() || !privateKey.trim() || !funderAddress.trim()) {
      toast.error('Nick_Name, POLYMARKET_PRIVATE_KEY ve POLYMARKET_FUNDER_ADDRESS zorunlu.');
      return;
    }

    setIsSaving(true);
    try {
      const wallet = await addExecutionWallet({
        nickName,
        privateKey,
        funderAddress,
      });
      toast.success(`${wallet.nickName} eklendi ve aktif wallet olarak seçildi.`);
      closeModal();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Wallet eklenemedi');
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
              <label className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-1 block">
                Aktif Trade Wallet
              </label>
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
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-background/80 backdrop-blur-sm px-4">
          <div className="w-full max-w-lg rounded-2xl border border-border/40 bg-card/95 shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border/30">
              <div>
                <h2 className="text-base font-semibold text-foreground">Wallet Ekle</h2>
                <p className="text-xs text-muted-foreground">Bu wallet yeni gerçek trade session’larında kullanılacak.</p>
              </div>
              <button
                type="button"
                onClick={closeModal}
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
                  value={nickName}
                  onChange={(e) => setNickName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-secondary/50 border border-border/30 text-sm"
                  placeholder="Örn: Main Wallet"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">POLYMARKET_PRIVATE_KEY</span>
                <input
                  type="password"
                  value={privateKey}
                  onChange={(e) => setPrivateKey(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-secondary/50 border border-border/30 text-sm"
                  placeholder="0x..."
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">POLYMARKET_FUNDER_ADDRESS</span>
                <input
                  type="text"
                  value={funderAddress}
                  onChange={(e) => setFunderAddress(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-secondary/50 border border-border/30 text-sm"
                  placeholder="0x..."
                />
              </label>

              <p className="text-[11px] text-muted-foreground">
                Girilen bilgiler `.env` dosyasına kaydedilir ve uygulama yeniden başlamadan kullanılabilir.
              </p>
            </div>

            <div className="px-5 py-4 border-t border-border/30 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={closeModal}
                className="px-4 py-2 rounded-lg text-sm border border-border/30 text-muted-foreground hover:text-foreground hover:bg-secondary/50"
              >
                Vazgeç
              </button>
              <button
                type="button"
                onClick={() => { void handleSaveWallet(); }}
                disabled={isSaving}
                className="px-4 py-2 rounded-lg text-sm bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20 disabled:opacity-50"
              >
                {isSaving ? 'Kaydediliyor...' : 'Wallet Kaydet'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
