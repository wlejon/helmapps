# broterm: the user's .zlogin from their real ZDOTDIR (see .zshenv), then
# ZDOTDIR handed back.
ZDOTDIR=$__broterm_user_zdotdir
[[ -r $ZDOTDIR/.zlogin ]] && source $ZDOTDIR/.zlogin
__broterm_user_zdotdir=$ZDOTDIR
ZDOTDIR=$__broterm_zdotdir
__broterm_handback
