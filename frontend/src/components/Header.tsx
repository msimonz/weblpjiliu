import Image from "next/image";

export default function Header({
  userLabel,
  onLogout,
}: {
  userLabel?: string;
  onLogout?: () => void;
}) {
  return (
    <header className="topbar">
      <div className="container topbar-inner">
        <div className="brand">
          <div className="brand-logos">
            <Image className="logo" src="/jiliu.png" alt="JILIU" width={34} height={34} />
            <Image className="logo" src="/lapromesa.png" alt="La Promesa" width={34} height={34} />
          </div>
          <div className="brand-title">
            <b>JILIU · La Promesa</b>
            <span>Notas y asignaciones</span>
          </div>
        </div>

        <div className="row">
          {userLabel ? <span className="badge">{userLabel}</span> : null}
          {onLogout ? (
            <button className="btn btn-ghost" onClick={onLogout}>
              Salir
            </button>
          ) : null}
        </div>
      </div>
    </header>
  );
}
