# broterm: the user's .zshrc from their real ZDOTDIR (see .zshenv), then the
# integration, then (unless this is a login shell, whose .zlogin comes next)
# ZDOTDIR handed back.
ZDOTDIR=$__broterm_user_zdotdir
[[ -r $ZDOTDIR/.zshrc ]] && source $ZDOTDIR/.zshrc
__broterm_user_zdotdir=$ZDOTDIR
ZDOTDIR=$__broterm_zdotdir

source $__broterm_zdotdir/broterm.zsh

if [[ ! -o login ]]; then
    __broterm_handback
fi
